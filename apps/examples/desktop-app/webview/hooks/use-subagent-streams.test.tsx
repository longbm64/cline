// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import type { SessionAgentEntry } from "@/lib/session-agents";
import { useSubagentStreams } from "./use-subagent-streams";

type EventListener = (payload: unknown) => void;

const { invokeMock, subscribeMock, emitSubagentEvent, resetSubscribers } =
	vi.hoisted(() => {
		const listeners = new Set<EventListener>();
		return {
			invokeMock: vi.fn(),
			subscribeMock: vi.fn((event: string, cb: EventListener) => {
				if (event === "subagent_chat_event") {
					listeners.add(cb);
				}
				return () => {
					listeners.delete(cb);
				};
			}),
			emitSubagentEvent: (payload: unknown) => {
				for (const listener of listeners) {
					listener(payload);
				}
			},
			resetSubscribers: () => {
				listeners.clear();
			},
		};
	});

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: invokeMock,
		subscribe: subscribeMock,
	},
}));

type StreamsResult = ReturnType<typeof useSubagentStreams>;

let container: HTMLDivElement;
let root: Root;
let current: StreamsResult;

function HookHarness({
	environmentId = "local",
	sessionId,
	sessionActive = true,
	agents = [],
	parentMessages = [],
	enabled = true,
	onAgentLifecycleChange,
}: {
	environmentId?: string;
	sessionId: string | null;
	sessionActive?: boolean;
	agents?: SessionAgentEntry[];
	parentMessages?: ChatMessage[];
	enabled?: boolean;
	onAgentLifecycleChange?: () => void;
}) {
	current = useSubagentStreams({
		environmentId,
		sessionId,
		sessionActive,
		agents,
		parentMessages,
		enabled,
		onAgentLifecycleChange,
	});
	return null;
}

async function renderHarness(props: Parameters<typeof HookHarness>[0]) {
	await act(async () => {
		root.render(<HookHarness {...props} />);
	});
}

function makeSpawnToolMessage(id: string, prompt: string): ChatMessage {
	return {
		id,
		sessionId: "root-session",
		role: "tool",
		content: JSON.stringify({
			toolName: "spawn_agent",
			input: { prompt },
			result: null,
		}),
		createdAt: Date.now(),
		meta: {
			toolName: "spawn_agent",
			hookEventName: "tool_call_start",
		},
	};
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	resetSubscribers();
	invokeMock.mockReset();
	invokeMock.mockImplementation(async (command: string) => {
		if (command === "read_subagent_live_streams") {
			return { boot: "boot-1", streams: {} };
		}
		if (command === "read_session_messages") {
			return [];
		}
		return null;
	});
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("useSubagentStreams", () => {
	it("streams 4 parallel subagents simultaneously and isolates their messages", async () => {
		vi.useFakeTimers();
		const onLifecycle = vi.fn();

		const agents: SessionAgentEntry[] = [1, 2, 3, 4].map((idx) => ({
			sessionId: `root-session__agent_${idx}`,
			agentId: `agent_${idx}`,
			kind: "subagent",
			status: "running",
			prompt: `Task ${idx}`,
			startedAt: "2026-11-11T00:00:00.000Z",
			hasMessages: false,
		}));

		await renderHarness({
			sessionId: "root-session",
			sessionActive: true,
			agents,
			onAgentLifecycleChange: onLifecycle,
		});

		expect(current.columns).toHaveLength(4);
		expect(current.liveRunningCount).toBe(4);

		await act(async () => {
			for (let idx = 1; idx <= 4; idx++) {
				emitSubagentEvent({
					environmentId: "local",
					sessionId: "root-session",
					agentId: `agent_${idx}`,
					kind: "subagent",
					stream: "chat_text",
					chunk: `Output from subagent ${idx}`,
					index: 1,
					boot: "boot-1",
				});
			}
			emitSubagentEvent({
				environmentId: "local",
				sessionId: "root-session",
				agentId: "agent_2",
				kind: "subagent",
				stream: "chat_tool_call_start",
				chunk: JSON.stringify({
					toolCallId: "tc-2",
					toolName: "read_files",
					input: { paths: ["src/index.ts"] },
				}),
				index: 2,
				boot: "boot-1",
			});
			emitSubagentEvent({
				environmentId: "local",
				sessionId: "root-session",
				agentId: "agent_2",
				kind: "subagent",
				stream: "chat_tool_call_end",
				chunk: JSON.stringify({
					toolCallId: "tc-2",
					toolName: "read_files",
					output: "export const ok = true;",
				}),
				index: 3,
				boot: "boot-1",
			});
			vi.advanceTimersByTime(100);
		});

		for (let idx = 1; idx <= 4; idx++) {
			const col = current.columns[idx - 1];
			expect(col?.agentId).toBe(`agent_${idx}`);
			expect(col?.state).toBe("running");
			expect(
				col?.messages.some(
					(m) => m.role === "user" && m.content === `Task ${idx}`,
				),
			).toBe(true);
			expect(
				col?.messages.some(
					(m) =>
						m.role === "assistant" &&
						m.content.includes(`Output from subagent ${idx}`),
				),
			).toBe(true);
		}
		expect(
			current.columns[1]?.messages.some(
				(m) => m.role === "tool" && m.meta?.toolName === "read_files",
			),
		).toBe(true);
		expect(current.columns[0]?.messages.some((m) => m.role === "tool")).toBe(
			false,
		);

		// Finish all 4 subagents via chat_done even before SQLite refreshes
		await act(async () => {
			for (let idx = 1; idx <= 4; idx++) {
				emitSubagentEvent({
					environmentId: "local",
					sessionId: "root-session",
					agentId: `agent_${idx}`,
					kind: "subagent",
					stream: "chat_done",
					chunk: JSON.stringify({ reason: "completed" }),
					index: 10,
					boot: "boot-1",
				});
			}
			vi.advanceTimersByTime(100);
		});

		expect(current.liveRunningCount).toBe(0);
		expect(current.columns.map((c) => c.state)).toEqual([
			"completed",
			"completed",
			"completed",
			"completed",
		]);
		expect(onLifecycle).toHaveBeenCalled();
	});

	it("synthesizes zero-latency placeholder columns from in-flight spawn_agent calls without duplicating once live events arrive", async () => {
		const parentMessages: ChatMessage[] = [
			makeSpawnToolMessage("m1", "Audit auth module"),
			makeSpawnToolMessage("m2", "Audit billing module"),
			makeSpawnToolMessage("m3", "Audit notifications module"),
			makeSpawnToolMessage("m4", "Audit search module"),
		];

		await renderHarness({
			sessionId: "root-session",
			sessionActive: true,
			agents: [],
			parentMessages,
		});

		expect(current.columns).toHaveLength(4);
		expect(current.columns.map((c) => c.prompt)).toEqual([
			"Audit auth module",
			"Audit billing module",
			"Audit notifications module",
			"Audit search module",
		]);

		// Two live streams start arriving before SQLite persists rows; total stays 4.
		await act(async () => {
			emitSubagentEvent({
				environmentId: "local",
				sessionId: "root-session",
				agentId: "live_1",
				kind: "subagent",
				stream: "chat_tool_call_start",
				chunk: JSON.stringify({ toolCallId: "t1", toolName: "read_files" }),
				index: 1,
				boot: "boot-1",
			});
			emitSubagentEvent({
				environmentId: "local",
				sessionId: "root-session",
				agentId: "live_2",
				kind: "subagent",
				stream: "chat_tool_call_start",
				chunk: JSON.stringify({ toolCallId: "t2", toolName: "read_files" }),
				index: 1,
				boot: "boot-1",
			});
		});

		expect(current.columns).toHaveLength(4);
		expect(current.columns[0]?.agentId).toBe("live_1");
		expect(current.columns[1]?.agentId).toBe("live_2");
	});

	it("replays buffered live streams on mount and deduplicates overlapping chunk indices", async () => {
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "read_subagent_live_streams") {
				return {
					boot: "boot-9",
					streams: {
						agent_a: [
							{
								agentId: "agent_a",
								kind: "subagent",
								stream: "chat_text",
								chunk: "Hello ",
								ts: 100,
								index: 1,
							},
							{
								agentId: "agent_a",
								kind: "subagent",
								stream: "chat_text",
								chunk: "world",
								ts: 101,
								index: 2,
							},
						],
					},
				};
			}
			return [];
		});

		await renderHarness({
			sessionId: "root-session",
			sessionActive: true,
			agents: [],
		});

		// Wait for replay promise resolution
		await act(async () => {
			await Promise.resolve();
		});

		expect(current.columns).toHaveLength(1);
		expect(current.columns[0]?.messages[0]?.content).toBe("Hello world");

		// Duplicate index 2 must be ignored, index 3 appended
		vi.useFakeTimers();
		await act(async () => {
			emitSubagentEvent({
				environmentId: "local",
				sessionId: "root-session",
				agentId: "agent_a",
				kind: "subagent",
				stream: "chat_text",
				chunk: "world",
				index: 2,
				boot: "boot-9",
			});
			emitSubagentEvent({
				environmentId: "local",
				sessionId: "root-session",
				agentId: "agent_a",
				kind: "subagent",
				stream: "chat_text",
				chunk: "!",
				index: 3,
				boot: "boot-9",
			});
			vi.advanceTimersByTime(60);
		});

		expect(current.columns[0]?.messages[0]?.content).toBe("Hello world!");
	});

	it("hydrates persisted transcripts for completed child sessions when enabled", async () => {
		const persistedMessages: ChatMessage[] = [
			{
				id: "u1",
				sessionId: "root-session__agent_done",
				role: "user",
				content: "Write unit tests",
				createdAt: 1000,
			},
			{
				id: "a1",
				sessionId: "root-session__agent_done",
				role: "assistant",
				content: "Added 12 unit tests covering all edge cases.",
				createdAt: 1005,
			},
		];

		invokeMock.mockImplementation(async (command: string) => {
			if (command === "read_subagent_live_streams") {
				return { boot: "boot-1", streams: {} };
			}
			if (command === "read_session_messages") {
				return persistedMessages;
			}
			return [];
		});

		await renderHarness({
			sessionId: "root-session",
			sessionActive: false,
			enabled: true,
			agents: [
				{
					sessionId: "root-session__agent_done",
					agentId: "agent_done",
					kind: "subagent",
					status: "completed",
					prompt: "Write unit tests",
					startedAt: "2026-11-11T00:00:00.000Z",
					hasMessages: true,
				},
			],
		});

		await act(async () => {
			await Promise.resolve();
		});

		expect(invokeMock).toHaveBeenCalledWith("read_session_messages", {
			environmentId: "local",
			sessionId: "root-session__agent_done",
			maxMessages: 400,
		});
		expect(current.columns[0]?.messages).toHaveLength(2);
		expect(current.columns[0]?.messages[1]?.content).toContain(
			"Added 12 unit tests",
		);
	});

	it("does not resurrect stale prior-turn running subagents when a new user turn starts", async () => {
		await renderHarness({
			sessionId: "root-session",
			sessionActive: true,
			agents: [
				{
					sessionId: "root-session__stale_agent",
					agentId: "stale_agent",
					kind: "subagent",
					status: "running",
					prompt: "Old interrupted subagent",
					startedAt: "2026-11-11T00:00:00.000Z",
					hasMessages: true,
				},
			],
			parentMessages: [
				{
					id: "u1",
					sessionId: "root-session",
					role: "user",
					content: "First turn",
					createdAt: Date.parse("2026-11-11T00:00:00.000Z"),
				},
				makeSpawnToolMessage("m_stale", "Old interrupted subagent"),
				{
					id: "u2",
					sessionId: "root-session",
					role: "user",
					content: "Second turn without subagents",
					createdAt: Date.parse("2026-11-11T00:05:00.000Z"),
				},
			],
		});

		expect(current.liveRunningCount).toBe(0);
		expect(current.columns).toHaveLength(1);
		expect(current.columns[0]?.state).toBe("unresolved");
	});
});
