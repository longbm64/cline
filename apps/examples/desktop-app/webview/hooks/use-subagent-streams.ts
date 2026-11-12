"use client";

import { isGeneratedMedia } from "@cline/shared/browser";
import { describeStreamingToolCall } from "@cline/ui/components/agent-chat/tool-summary";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildToolPayloadString, makeId } from "@/hooks/chat-session/helpers";
import type {
	ReasoningDeltaEvent,
	ToolCallEndEvent,
	ToolCallStartEvent,
	ToolCallUpdateEvent,
} from "@/hooks/chat-session/types";
import type { ChatMessage, ChatSessionStatus } from "@/lib/chat-schema";
import { appendCappedCommandOutput } from "@/lib/command-output";
import { desktopClient } from "@/lib/desktop-client";
import {
	agentEntryState,
	isAgentRunToolName,
	type SessionAgentEntry,
	type SessionAgentRunState,
} from "@/lib/session-agents";
import { eventEnvironmentId } from "@/lib/session-identity";

const STREAM_FLUSH_INTERVAL_MS = 48;
const MAX_SUBAGENT_MESSAGES = 400;
const EMPTY_PERSISTED_BY_CHILD: Record<
	string,
	{ terminal: boolean; messages: ChatMessage[] }
> = {};

type SubagentWireChunk = {
	sessionId?: string;
	agentId?: string;
	parentAgentId?: string;
	kind?: "subagent" | "teamtask";
	stream?: string;
	chunk?: string;
	ts?: number;
	index?: number;
	boot?: string;
};

type ReplayStreamsResponse = {
	boot?: string;
	streams?: Record<
		string,
		Array<{
			agentId: string;
			parentAgentId?: string;
			kind: "subagent" | "teamtask";
			stream: string;
			chunk: string;
			ts: number;
			index: number;
		}>
	>;
};

type PendingToolOutput = {
	text: string;
	truncated: boolean;
	detachable?: boolean;
};

type AgentStreamBuffer = {
	agentId: string;
	kind: "subagent" | "teamtask";
	seenBoot: string | null;
	maxIndex: number;
	order: number;
	messages: ChatMessage[];
	activeAssistantId: string | null;
	liveToolMessageIds: Map<string, string>;
	liveToolInputs: Map<string, unknown>;
	pendingText: Map<string, string>;
	pendingReasoning: Map<string, { text: string; redacted: boolean }>;
	pendingToolOutput: Map<string, PendingToolOutput>;
	streamingToolLabel: string | null;
	doneReason: string | null;
	errorText: string | null;
	lastChunkAt: number;
};

export type SubagentColumnData = {
	key: string;
	agentId: string;
	sessionId: string | null;
	kind: "subagent" | "teamtask";
	teamName?: string;
	prompt?: string;
	model?: string;
	provider?: string;
	state: SessionAgentRunState;
	chatStatus: ChatSessionStatus;
	messages: ChatMessage[];
	streamingMessageId: string | null;
	streamingToolLabel?: string | null;
	error: string | null;
};

function createAgentStreamBuffer(
	agentId: string,
	kind: "subagent" | "teamtask",
	order: number,
): AgentStreamBuffer {
	return {
		agentId,
		kind,
		seenBoot: null,
		maxIndex: 0,
		order,
		messages: [],
		activeAssistantId: null,
		liveToolMessageIds: new Map(),
		liveToolInputs: new Map(),
		pendingText: new Map(),
		pendingReasoning: new Map(),
		pendingToolOutput: new Map(),
		streamingToolLabel: null,
		doneReason: null,
		errorText: null,
		lastChunkAt: 0,
	};
}

function flushBufferDeltas(buffer: AgentStreamBuffer): boolean {
	let changed = false;
	if (
		buffer.pendingText.size === 0 &&
		buffer.pendingReasoning.size === 0 &&
		buffer.pendingToolOutput.size === 0
	) {
		return false;
	}

	const pendingText = buffer.pendingText;
	const pendingReasoning = buffer.pendingReasoning;
	const pendingToolOutput = buffer.pendingToolOutput;
	buffer.pendingText = new Map();
	buffer.pendingReasoning = new Map();
	buffer.pendingToolOutput = new Map();

	buffer.messages = buffer.messages.map((msg) => {
		let next = msg;
		const textDelta = pendingText.get(msg.id);
		if (textDelta) {
			next = { ...next, content: `${next.content}${textDelta}` };
			changed = true;
		}
		const reasoningDelta = pendingReasoning.get(msg.id);
		if (reasoningDelta) {
			const chunk =
				reasoningDelta.text || (reasoningDelta.redacted ? "[redacted]" : "");
			const existing = next.reasoning ?? "";
			if (chunk && !existing.endsWith(chunk)) {
				next = {
					...next,
					reasoning: `${existing}${chunk}`,
					reasoningRedacted:
						Boolean(next.reasoningRedacted) || reasoningDelta.redacted,
				};
				changed = true;
			} else if (reasoningDelta.redacted && !next.reasoningRedacted) {
				next = { ...next, reasoningRedacted: true };
				changed = true;
			}
		}
		const toolOut = pendingToolOutput.get(msg.id);
		if (toolOut) {
			const merged = appendCappedCommandOutput(
				next.meta?.toolOutput ?? "",
				toolOut.text,
			);
			const toolOutputTruncated = Boolean(
				next.meta?.toolOutputTruncated || toolOut.truncated || merged.truncated,
			);
			const toolDetachable = toolOut.detachable ?? next.meta?.toolDetachable;
			next = {
				...next,
				meta: {
					...next.meta,
					toolOutput: merged.output,
					toolOutputTruncated,
					...(toolDetachable !== undefined ? { toolDetachable } : {}),
				},
			};
			changed = true;
		}
		return next;
	});

	return changed;
}

function ensureAssistantMessage(
	buffer: AgentStreamBuffer,
	sessionId: string,
	ts: number,
): string {
	if (buffer.activeAssistantId) {
		return buffer.activeAssistantId;
	}
	const id = makeId("sub_assistant");
	buffer.activeAssistantId = id;
	buffer.messages = [
		...buffer.messages.slice(-(MAX_SUBAGENT_MESSAGES - 1)),
		{
			id,
			sessionId,
			role: "assistant",
			content: "",
			createdAt: ts,
		},
	];
	return id;
}

type SpawnPromptCandidate = {
	id: string;
	prompt?: string;
	inProgress: boolean;
};

const cachedSpawnCandidateByMessage = new WeakMap<
	ChatMessage,
	SpawnPromptCandidate | null
>();

function isRealUserTurnBoundary(message: ChatMessage): boolean {
	return (
		message.role === "user" &&
		!(
			message.meta?.userRunSpan === 0 &&
			message.content.trimStart().startsWith("[SYSTEM]")
		)
	);
}

function findLatestUserTurnStartedAt(
	messages: ChatMessage[],
): number | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (isRealUserTurnBoundary(message) && Number.isFinite(message.createdAt)) {
			return message.createdAt;
		}
	}
	return undefined;
}

function extractInFlightSpawnPrompts(
	parentMessages: ChatMessage[],
): SpawnPromptCandidate[] {
	const results: SpawnPromptCandidate[] = [];
	let startIndex = 0;
	for (let index = parentMessages.length - 1; index >= 0; index--) {
		if (isRealUserTurnBoundary(parentMessages[index])) {
			startIndex = index + 1;
			break;
		}
	}
	for (let index = startIndex; index < parentMessages.length; index++) {
		const message = parentMessages[index];
		if (message.role !== "tool") continue;
		if (cachedSpawnCandidateByMessage.has(message)) {
			const cached = cachedSpawnCandidateByMessage.get(message);
			if (cached) {
				results.push(cached);
			}
			continue;
		}
		const metaToolName = message.meta?.toolName;
		if (metaToolName && !isAgentRunToolName(metaToolName)) {
			cachedSpawnCandidateByMessage.set(message, null);
			continue;
		}
		let parsed: {
			toolName?: string;
			input?: unknown;
			result?: unknown;
			isError?: boolean;
		} | null = null;
		try {
			parsed = JSON.parse(message.content);
		} catch {
			cachedSpawnCandidateByMessage.set(message, null);
			continue;
		}
		const toolName = metaToolName || parsed?.toolName;
		if (!isAgentRunToolName(toolName)) {
			cachedSpawnCandidateByMessage.set(message, null);
			continue;
		}
		const inputObj =
			parsed?.input &&
			typeof parsed.input === "object" &&
			!Array.isArray(parsed.input)
				? (parsed.input as Record<string, unknown>)
				: null;
		const rawPrompt =
			inputObj?.task ?? inputObj?.prompt ?? inputObj?.message ?? undefined;
		const prompt =
			typeof rawPrompt === "string" && rawPrompt.trim().length > 0
				? rawPrompt.trim()
				: undefined;
		const inProgress =
			message.meta?.hookEventName === "tool_call_start" ||
			(parsed?.result == null && !parsed?.isError);
		const candidate: SpawnPromptCandidate = {
			id: message.id,
			prompt,
			inProgress,
		};
		cachedSpawnCandidateByMessage.set(message, candidate);
		results.push(candidate);
	}
	return results;
}

function mapRunStateToChatStatus(
	state: SessionAgentRunState,
): ChatSessionStatus {
	switch (state) {
		case "running":
			return "running";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "cancelled":
			return "cancelled";
		default:
			return "idle";
	}
}

function resolveStateFromLiveBuffer(
	buffer: AgentStreamBuffer | undefined,
	persistedState: SessionAgentRunState | undefined,
	sessionActive: boolean,
	options?: {
		startedAt?: string;
		kind?: "subagent" | "teamtask";
		lastUserTurnStartedAt?: number;
	},
): SessionAgentRunState {
	if (persistedState && persistedState !== "running") {
		return persistedState;
	}
	if (buffer?.doneReason) {
		if (buffer.doneReason === "aborted" || buffer.doneReason === "cancelled") {
			return "cancelled";
		}
		if (buffer.doneReason === "error" || buffer.doneReason === "failed") {
			return "failed";
		}
		return "completed";
	}
	if (!sessionActive) {
		return "unresolved";
	}
	const lastUserTurnStartedAt = options?.lastUserTurnStartedAt;
	const kind = options?.kind ?? buffer?.kind;
	if (lastUserTurnStartedAt !== undefined && kind === "subagent") {
		const hasCurrentTurnChunk = Boolean(
			buffer &&
				buffer.lastChunkAt > 0 &&
				buffer.lastChunkAt >= lastUserTurnStartedAt - 2_000,
		);
		if (!hasCurrentTurnChunk) {
			const startedMs = options?.startedAt
				? Date.parse(options.startedAt)
				: Number.NaN;
			if (
				Number.isFinite(startedMs) &&
				startedMs < lastUserTurnStartedAt - 2_000
			) {
				return "unresolved";
			}
			if (
				!options?.startedAt &&
				buffer &&
				buffer.lastChunkAt > 0 &&
				buffer.lastChunkAt < lastUserTurnStartedAt - 2_000
			) {
				return "unresolved";
			}
		}
	}
	if (persistedState === "running" || buffer) {
		return "running";
	}
	return persistedState ?? "unresolved";
}

function withLeadingPromptMessage(
	messages: ChatMessage[],
	sessionId: string,
	agentKey: string,
	prompt: string | undefined,
): ChatMessage[] {
	const trimmed = prompt?.trim();
	if (!trimmed) {
		return messages;
	}
	if (messages.some((m) => m.role === "user")) {
		return messages;
	}
	const firstCreatedAt = messages[0]?.createdAt ?? Date.now();
	const syntheticUser: ChatMessage = {
		id: `sub_prompt_${agentKey}`,
		sessionId,
		role: "user",
		content: trimmed,
		createdAt: Math.max(0, firstCreatedAt - 1),
	};
	return [syntheticUser, ...messages];
}

export function useSubagentStreams({
	environmentId,
	sessionId,
	sessionActive,
	agents,
	parentMessages,
	enabled,
	onAgentLifecycleChange,
}: {
	environmentId: string;
	sessionId: string | null;
	sessionActive: boolean;
	agents: SessionAgentEntry[];
	parentMessages: ChatMessage[];
	/** Hydrates persisted transcripts on demand when columns are visible or active. */
	enabled: boolean;
	onAgentLifecycleChange?: () => void;
}) {
	const buffersRef = useRef<{
		environmentId: string | null;
		sessionId: string | null;
		nextOrder: number;
		byAgentId: Map<string, AgentStreamBuffer>;
	}>({
		environmentId: null,
		sessionId: null,
		nextOrder: 0,
		byAgentId: new Map(),
	});
	const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lifecycleRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const [streamVersion, setStreamVersion] = useState(0);

	// Canonical persisted messages keyed by child sessionId, tagged with parent
	// session identity so switching sessions never leaks or requires an extra reset render.
	const [persistedCache, setPersistedCache] = useState<{
		environmentId: string | null;
		sessionId: string | null;
		byChildId: Record<string, { terminal: boolean; messages: ChatMessage[] }>;
	}>({
		environmentId: null,
		sessionId: null,
		byChildId: EMPTY_PERSISTED_BY_CHILD,
	});
	const persistedBySessionId =
		persistedCache.environmentId === environmentId &&
		persistedCache.sessionId === sessionId
			? persistedCache.byChildId
			: EMPTY_PERSISTED_BY_CHILD;
	const persistedBySessionIdRef = useRef(persistedBySessionId);
	persistedBySessionIdRef.current = persistedBySessionId;
	const inflightHydrationsRef = useRef(new Set<string>());
	const mountedRef = useRef(true);

	if (
		buffersRef.current.environmentId !== environmentId ||
		buffersRef.current.sessionId !== sessionId
	) {
		buffersRef.current = {
			environmentId,
			sessionId,
			nextOrder: 0,
			byAgentId: new Map(),
		};
	}

	const flushAllPending = useCallback(() => {
		if (flushTimerRef.current !== null) {
			clearTimeout(flushTimerRef.current);
			flushTimerRef.current = null;
		}
		let anyChanged = false;
		for (const buffer of buffersRef.current.byAgentId.values()) {
			if (flushBufferDeltas(buffer)) {
				anyChanged = true;
			}
		}
		if (anyChanged) {
			setStreamVersion((v) => v + 1);
		}
	}, []);

	const scheduleFlush = useCallback(() => {
		if (flushTimerRef.current !== null) {
			return;
		}
		flushTimerRef.current = setTimeout(() => {
			flushTimerRef.current = null;
			flushAllPending();
		}, STREAM_FLUSH_INTERVAL_MS);
	}, [flushAllPending]);

	const notifyLifecycleChange = useCallback(() => {
		if (!onAgentLifecycleChange) return;
		if (lifecycleRefreshTimerRef.current !== null) return;
		lifecycleRefreshTimerRef.current = setTimeout(() => {
			lifecycleRefreshTimerRef.current = null;
			onAgentLifecycleChange();
		}, 80);
	}, [onAgentLifecycleChange]);

	const applyWireChunk = useCallback(
		(payload: SubagentWireChunk, options?: { batchReplay?: boolean }) => {
			const targetSessionId = payload.sessionId?.trim();
			if (!targetSessionId || targetSessionId !== sessionId) {
				return false;
			}
			const agentId = payload.agentId?.trim();
			const stream = payload.stream?.trim();
			if (!agentId || !stream) {
				return false;
			}
			const chunk = typeof payload.chunk === "string" ? payload.chunk : "";
			const ts = typeof payload.ts === "number" ? payload.ts : Date.now();
			const kind = payload.kind === "teamtask" ? "teamtask" : "subagent";

			let isNewAgent = false;
			let buffer = buffersRef.current.byAgentId.get(agentId);
			if (!buffer) {
				isNewAgent = true;
				buffer = createAgentStreamBuffer(
					agentId,
					kind,
					buffersRef.current.nextOrder++,
				);
				buffersRef.current.byAgentId.set(agentId, buffer);
			}

			if (typeof payload.boot === "string" && payload.boot) {
				if (buffer.seenBoot && buffer.seenBoot !== payload.boot) {
					buffer.maxIndex = 0;
				}
				buffer.seenBoot = payload.boot;
			}
			if (typeof payload.index === "number") {
				if (payload.index <= buffer.maxIndex) {
					return false;
				}
				buffer.maxIndex = payload.index;
			}
			buffer.lastChunkAt = Math.max(buffer.lastChunkAt, ts);

			const virtualSessionId = `${targetSessionId}__${agentId}`;

			if (stream === "chat_text") {
				if (!chunk) return isNewAgent;
				const clearedToolLabel = buffer.streamingToolLabel !== null;
				buffer.streamingToolLabel = null;
				const assistantId = ensureAssistantMessage(
					buffer,
					virtualSessionId,
					ts,
				);
				buffer.pendingText.set(
					assistantId,
					(buffer.pendingText.get(assistantId) ?? "") + chunk,
				);
				if (!options?.batchReplay) {
					scheduleFlush();
				}
				if (isNewAgent && !options?.batchReplay) {
					notifyLifecycleChange();
					return true;
				}
				return clearedToolLabel;
			}

			if (stream === "chat_reasoning") {
				let parsed: ReasoningDeltaEvent = {};
				try {
					parsed = JSON.parse(chunk) as ReasoningDeltaEvent;
				} catch {
					parsed = { text: chunk };
				}
				let clearedToolLabel = false;
				if (parsed.text || parsed.redacted === true) {
					clearedToolLabel = buffer.streamingToolLabel !== null;
					buffer.streamingToolLabel = null;
					const assistantId = ensureAssistantMessage(
						buffer,
						virtualSessionId,
						ts,
					);
					const existing = buffer.pendingReasoning.get(assistantId);
					buffer.pendingReasoning.set(assistantId, {
						text: `${existing?.text ?? ""}${parsed.text ?? ""}`,
						redacted: (existing?.redacted ?? false) || parsed.redacted === true,
					});
					if (!options?.batchReplay) {
						scheduleFlush();
					}
				}
				if (isNewAgent && !options?.batchReplay) {
					notifyLifecycleChange();
					return true;
				}
				return clearedToolLabel;
			}

			if (stream === "chat_tool_call_update") {
				let parsed: ToolCallUpdateEvent = {};
				try {
					parsed = JSON.parse(chunk) as ToolCallUpdateEvent;
				} catch {
					return isNewAgent;
				}
				const update =
					parsed.update &&
					typeof parsed.update === "object" &&
					!Array.isArray(parsed.update)
						? (parsed.update as Record<string, unknown>)
						: undefined;
				if (update?.phase === "input_streaming") {
					flushBufferDeltas(buffer);
					buffer.activeAssistantId = null;
					const nextLabel = describeStreamingToolCall(
						parsed.toolName ?? "tool",
						typeof update.inputPreview === "string"
							? update.inputPreview
							: undefined,
					);
					const changed = buffer.streamingToolLabel !== nextLabel || isNewAgent;
					buffer.streamingToolLabel = nextLabel;
					if (isNewAgent && !options?.batchReplay) {
						notifyLifecycleChange();
					}
					return changed;
				}
				const toolCallId = parsed.toolCallId;
				const messageId = toolCallId
					? buffer.liveToolMessageIds.get(toolCallId)
					: undefined;
				if (!messageId) return isNewAgent;
				if (!update) return isNewAgent;
				const outStream = update.stream;
				const outChunk =
					(outStream === "stdout" || outStream === "stderr") &&
					typeof update.chunk === "string"
						? update.chunk
						: "";
				const detachable =
					typeof update.detachable === "boolean"
						? update.detachable
						: undefined;
				if (outChunk || detachable !== undefined) {
					const prev = buffer.pendingToolOutput.get(messageId);
					const merged = appendCappedCommandOutput(prev?.text ?? "", outChunk);
					buffer.pendingToolOutput.set(messageId, {
						text: merged.output,
						truncated: Boolean(prev?.truncated || merged.truncated),
						detachable: detachable ?? prev?.detachable,
					});
					if (!options?.batchReplay) {
						scheduleFlush();
					}
				}
				return isNewAgent;
			}

			// Flush pending deltas before structural boundaries so messages stay ordered.
			flushBufferDeltas(buffer);

			if (stream === "chat_tool_call_start") {
				let parsed: ToolCallStartEvent = {};
				try {
					parsed = JSON.parse(chunk) as ToolCallStartEvent;
				} catch {
					return isNewAgent;
				}
				const toolName = parsed.toolName ?? "tool";
				const toolCallId = parsed.toolCallId ?? makeId("sub_tool_call");
				const messageId = makeId("sub_tool");
				buffer.liveToolMessageIds.set(toolCallId, messageId);
				buffer.liveToolInputs.set(toolCallId, parsed.input);
				buffer.activeAssistantId = null;
				buffer.streamingToolLabel = null;
				buffer.messages = [
					...buffer.messages.slice(-(MAX_SUBAGENT_MESSAGES - 1)),
					{
						id: messageId,
						sessionId: virtualSessionId,
						role: "tool",
						content: buildToolPayloadString({
							toolName,
							input: parsed.input,
							output: null,
						}),
						createdAt: ts,
						meta: {
							toolName,
							toolCallId,
							hookEventName: "tool_call_start",
						},
					},
				];
				if (isNewAgent && !options?.batchReplay) {
					notifyLifecycleChange();
				}
				return true;
			}

			if (stream === "chat_tool_call_end") {
				buffer.streamingToolLabel = null;
				let parsed: ToolCallEndEvent = {};
				try {
					parsed = JSON.parse(chunk) as ToolCallEndEvent;
				} catch {
					return isNewAgent;
				}
				const toolName = parsed.toolName ?? "tool";
				const toolCallId = parsed.toolCallId;
				const messageId = toolCallId
					? buffer.liveToolMessageIds.get(toolCallId)
					: undefined;
				const toolInput =
					parsed.input ??
					(toolCallId ? buffer.liveToolInputs.get(toolCallId) : undefined);
				if (toolCallId) {
					buffer.liveToolMessageIds.delete(toolCallId);
					buffer.liveToolInputs.delete(toolCallId);
				}
				if (messageId) {
					buffer.messages = buffer.messages.map((msg) =>
						msg.id === messageId
							? {
									...msg,
									content: buildToolPayloadString({
										toolName,
										input: toolInput,
										output: parsed.output ?? msg.meta?.toolOutput ?? null,
										error: parsed.error,
									}),
									meta: {
										...msg.meta,
										toolName,
										toolCallId,
										toolDetachable: false,
										hookEventName: "tool_call_end",
									},
								}
							: msg,
					);
					return true;
				}
				return isNewAgent;
			}

			if (stream === "chat_media") {
				try {
					const media = JSON.parse(chunk) as unknown;
					if (isGeneratedMedia(media)) {
						const assistantId = ensureAssistantMessage(
							buffer,
							virtualSessionId,
							ts,
						);
						buffer.messages = buffer.messages.map((msg) =>
							msg.id === assistantId
								? { ...msg, media: [...(msg.media ?? []), media] }
								: msg,
						);
						return true;
					}
				} catch {
					// Ignore malformed media chunk.
				}
				return isNewAgent;
			}

			if (stream === "chat_core_log") {
				try {
					const parsed = JSON.parse(chunk) as {
						level?: string;
						message?: string;
					};
					if (parsed.level === "error" && parsed.message?.trim()) {
						buffer.errorText = parsed.message.trim();
						return true;
					}
				} catch {
					// Ignore malformed log chunk.
				}
				return isNewAgent;
			}

			if (stream === "chat_usage") {
				const changed = buffer.activeAssistantId !== null || isNewAgent;
				buffer.activeAssistantId = null;
				return changed;
			}

			if (stream === "chat_done") {
				buffer.activeAssistantId = null;
				buffer.streamingToolLabel = null;
				try {
					const parsed = JSON.parse(chunk) as {
						reason?: string;
						text?: string;
					};
					buffer.doneReason = parsed.reason || "completed";
					if (
						parsed.text?.trim() &&
						!buffer.messages.some(
							(m) => m.role === "assistant" && m.content.trim().length > 0,
						)
					) {
						buffer.messages = [
							...buffer.messages.slice(-(MAX_SUBAGENT_MESSAGES - 1)),
							{
								id: makeId("sub_assistant"),
								sessionId: virtualSessionId,
								role: "assistant",
								content: parsed.text,
								createdAt: ts,
							},
						];
					}
				} catch {
					buffer.doneReason = "completed";
				}
				if (!options?.batchReplay) {
					notifyLifecycleChange();
				}
				return true;
			}

			if (isNewAgent && !options?.batchReplay) {
				notifyLifecycleChange();
				return true;
			}
			return isNewAgent;
		},
		[notifyLifecycleChange, scheduleFlush, sessionId],
	);

	// Clean up timers on unmount.
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			if (flushTimerRef.current !== null) {
				clearTimeout(flushTimerRef.current);
			}
			if (lifecycleRefreshTimerRef.current !== null) {
				clearTimeout(lifecycleRefreshTimerRef.current);
			}
		};
	}, []);

	// Subscribe to live subagent chunks and replay any in-memory buffered chunks
	// when re-attaching to a running session.
	useEffect(() => {
		if (!sessionId) {
			return;
		}
		let cancelled = false;

		const unsubscribe = desktopClient.subscribe(
			"subagent_chat_event",
			(payload) => {
				if (eventEnvironmentId(payload) !== environmentId) {
					return;
				}
				if (!payload || typeof payload !== "object") {
					return;
				}
				if (applyWireChunk(payload as SubagentWireChunk)) {
					setStreamVersion((v) => v + 1);
				}
			},
		);

		void desktopClient
			.invoke<ReplayStreamsResponse>("read_subagent_live_streams", {
				environmentId,
				sessionId,
			})
			.then((snapshot) => {
				if (cancelled || !snapshot?.streams) {
					return;
				}
				let changed = false;
				for (const chunks of Object.values(snapshot.streams)) {
					for (const item of chunks) {
						const didMutate = applyWireChunk(
							{
								...item,
								sessionId,
								boot: snapshot.boot,
							},
							{ batchReplay: true },
						);
						if (didMutate) changed = true;
					}
				}
				for (const buffer of buffersRef.current.byAgentId.values()) {
					if (flushBufferDeltas(buffer)) {
						changed = true;
					}
				}
				if (changed) {
					setStreamVersion((v) => v + 1);
				}
			})
			.catch(() => {
				// Older hosts or cloud sessions without live replay support safely ignore.
			});

		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [applyWireChunk, environmentId, sessionId]);

	// Hydrate canonical transcripts for persisted child sessions when columns are
	// visible or when a child session finishes.
	useEffect(() => {
		if (!enabled || !sessionId || agents.length === 0) {
			return;
		}
		const targetEnvironmentId = environmentId;
		const targetSessionId = sessionId;

		for (const agent of agents) {
			const childSessionId = agent.sessionId?.trim();
			if (!childSessionId) continue;
			const state = agentEntryState(agent.status);
			const isTerminal = state !== "running";
			if (!agent.hasMessages && !isTerminal) {
				continue;
			}
			const cached = persistedBySessionIdRef.current[childSessionId];
			if (cached && (cached.terminal || !isTerminal)) {
				continue;
			}
			const inflightKey = `${targetEnvironmentId}:${targetSessionId}:${childSessionId}:${isTerminal ? "1" : "0"}`;
			if (inflightHydrationsRef.current.has(inflightKey)) {
				continue;
			}
			inflightHydrationsRef.current.add(inflightKey);

			void desktopClient
				.invoke<ChatMessage[]>("read_session_messages", {
					environmentId: targetEnvironmentId,
					sessionId: childSessionId,
					maxMessages: MAX_SUBAGENT_MESSAGES,
				})
				.then((rows) => {
					if (!mountedRef.current) return;
					if (Array.isArray(rows) && rows.length > 0) {
						setPersistedCache((prev) => {
							const base =
								prev.environmentId === targetEnvironmentId &&
								prev.sessionId === targetSessionId
									? prev.byChildId
									: {};
							return {
								environmentId: targetEnvironmentId,
								sessionId: targetSessionId,
								byChildId: {
									...base,
									[childSessionId]: {
										terminal: isTerminal,
										messages: rows,
									},
								},
							};
						});
					}
				})
				.catch(() => {
					// Keep live buffer messages if reading persisted transcript fails.
				})
				.finally(() => {
					inflightHydrationsRef.current.delete(inflightKey);
				});
		}
	}, [agents, enabled, environmentId, sessionId]);

	const columns = useMemo<SubagentColumnData[]>(() => {
		void streamVersion;
		if (!sessionId) {
			return [];
		}
		const byAgentId = buffersRef.current.byAgentId;
		const seenAgentIds = new Set<string>();
		const out: SubagentColumnData[] = [];
		const lastUserTurnStartedAt = findLatestUserTurnStartedAt(parentMessages);

		for (const entry of agents) {
			seenAgentIds.add(entry.agentId);
			const liveBuffer = byAgentId.get(entry.agentId);
			const persistedState = agentEntryState(entry.status);
			const state = resolveStateFromLiveBuffer(
				liveBuffer,
				persistedState,
				sessionActive,
				{
					startedAt: entry.startedAt,
					kind: entry.kind,
					lastUserTurnStartedAt,
				},
			);
			const persisted = persistedBySessionId[entry.sessionId]?.messages;
			const rawMessages =
				state !== "running" && persisted && persisted.length > 0
					? persisted
					: liveBuffer && liveBuffer.messages.length > 0
						? liveBuffer.messages
						: (persisted ?? []);
			const messages = withLeadingPromptMessage(
				rawMessages,
				entry.sessionId,
				entry.agentId,
				entry.prompt,
			);
			out.push({
				key: entry.sessionId || entry.agentId,
				agentId: entry.agentId,
				sessionId: entry.sessionId,
				kind: entry.kind,
				teamName: entry.teamName,
				prompt: entry.prompt,
				model: entry.model,
				provider: entry.provider,
				state,
				chatStatus: mapRunStateToChatStatus(state),
				messages,
				streamingMessageId:
					state === "running" ? (liveBuffer?.activeAssistantId ?? null) : null,
				streamingToolLabel:
					state === "running" ? (liveBuffer?.streamingToolLabel ?? null) : null,
				error: liveBuffer?.errorText ?? null,
			});
		}

		// Include live-streaming child agents that SQLite has not returned yet.
		const unmatchedLive = [...byAgentId.values()]
			.filter((buf) => !seenAgentIds.has(buf.agentId))
			.sort((a, b) => a.order - b.order);

		const inProgressSpawns = extractInFlightSpawnPrompts(parentMessages).filter(
			(item) => item.inProgress,
		);
		const availablePrompts = [...inProgressSpawns];
		let runningPersistedCount = 0;
		for (const col of out) {
			if (col.state !== "running") continue;
			runningPersistedCount++;
			const trimmed = col.prompt?.trim();
			if (trimmed) {
				const matchIdx = availablePrompts.findIndex(
					(item) => item.prompt === trimmed,
				);
				if (matchIdx >= 0) {
					availablePrompts.splice(matchIdx, 1);
				}
			}
		}

		for (const buf of unmatchedLive) {
			const state = resolveStateFromLiveBuffer(buf, undefined, sessionActive, {
				kind: buf.kind,
				lastUserTurnStartedAt,
			});
			const fallbackPrompt = availablePrompts.shift()?.prompt;
			const virtualSessionId = `${sessionId}__${buf.agentId}`;
			out.push({
				key: buf.agentId,
				agentId: buf.agentId,
				sessionId: null,
				kind: buf.kind,
				prompt: fallbackPrompt,
				state,
				chatStatus: mapRunStateToChatStatus(state),
				messages: withLeadingPromptMessage(
					buf.messages,
					virtualSessionId,
					buf.agentId,
					fallbackPrompt,
				),
				streamingMessageId: state === "running" ? buf.activeAssistantId : null,
				streamingToolLabel: state === "running" ? buf.streamingToolLabel : null,
				error: buf.errorText,
			});
		}

		// Fill zero-latency placeholders for parallel `spawn_agent` tool calls
		// dispatched in the current turn before their first runtime event arrives.
		if (sessionActive) {
			const missingPlaceholders = Math.max(
				0,
				inProgressSpawns.length - runningPersistedCount - unmatchedLive.length,
			);
			for (
				let i = 0;
				i < missingPlaceholders && i < availablePrompts.length;
				i++
			) {
				const pending = availablePrompts[i];
				if (!pending) continue;
				const placeholderId = `pending_${pending.id}`;
				out.push({
					key: placeholderId,
					agentId: placeholderId,
					sessionId: null,
					kind: "subagent",
					prompt: pending.prompt,
					state: "running",
					chatStatus: "running",
					messages: withLeadingPromptMessage(
						[],
						sessionId,
						placeholderId,
						pending.prompt,
					),
					streamingMessageId: null,
					error: null,
				});
			}
		}

		return out;
	}, [
		agents,
		parentMessages,
		persistedBySessionId,
		sessionActive,
		sessionId,
		streamVersion,
	]);

	const liveRunningCount = useMemo(
		() => columns.filter((col) => col.state === "running").length,
		[columns],
	);

	return {
		columns,
		liveRunningCount,
	};
}
