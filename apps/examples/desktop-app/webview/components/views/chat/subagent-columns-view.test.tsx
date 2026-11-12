// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubagentColumnData } from "@/hooks/use-subagent-streams";
import type { SessionAgentActivity } from "@/lib/session-agents";
import { SubagentColumnsView } from "./subagent-columns-view";

CSSStyleSheet.prototype.replaceSync ??= function replaceSync() {} as never;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	HTMLElement.prototype.scrollTo = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

function makeFourColumns(): SubagentColumnData[] {
	return [1, 2, 3, 4].map((idx) => ({
		key: `root__sub_${idx}`,
		agentId: `agent_${idx}`,
		sessionId: `root__sub_${idx}`,
		kind: idx === 4 ? "teamtask" : "subagent",
		teamName: idx === 4 ? "qa" : undefined,
		prompt: `Parallel task #${idx}`,
		state: idx === 3 ? "completed" : "running",
		chatStatus: idx === 3 ? "completed" : "running",
		messages: [
			{
				id: `u_${idx}`,
				sessionId: `root__sub_${idx}`,
				role: "user",
				content: `Parallel task #${idx}`,
				createdAt: 1000 + idx,
			},
			{
				id: `a_${idx}`,
				sessionId: `root__sub_${idx}`,
				role: "assistant",
				content: `Streaming response from subagent ${idx}`,
				createdAt: 2000 + idx,
			},
		],
		streamingMessageId: idx === 3 ? null : `a_${idx}`,
		error: null,
	}));
}

const FOUR_ACTIVITY: SessionAgentActivity = {
	total: 4,
	running: 3,
	completed: 1,
	failed: 0,
	cancelled: 0,
	unresolved: 0,
};

describe("SubagentColumnsView", () => {
	it("renders all 4 parallel subagent columns side-by-side simultaneously", async () => {
		const onBackToMainChat = vi.fn();
		const onOpenAgentSession = vi.fn();

		await act(async () => {
			root.render(
				<SubagentColumnsView
					activity={FOUR_ACTIVITY}
					chatTransportState="connected"
					columns={makeFourColumns()}
					onAnswerAskQuestion={vi.fn()}
					onApproveToolApproval={vi.fn()}
					onBackToMainChat={onBackToMainChat}
					onOpenAgentSession={onOpenAgentSession}
					onRejectToolApproval={vi.fn()}
					pendingAskQuestions={[]}
					pendingToolApprovals={[]}
				/>,
			);
		});

		const columns = container.querySelectorAll("[data-subagent-column]");
		expect(columns).toHaveLength(4);
		expect(container.textContent).toContain(
			"Coordinating 4 agents: 3 running, 1 completed",
		);
		for (let idx = 1; idx <= 4; idx++) {
			expect(container.textContent).toContain(`Sub ${idx}`);
			expect(container.textContent).toContain(`Parallel task #${idx}`);
			expect(container.textContent).toContain(
				`Streaming response from subagent ${idx}`,
			);
		}
		expect(container.textContent).toContain("team:qa");

		const mainChatBtn =
			container.querySelector<HTMLButtonElement>("#back-to-main-chat");
		await act(async () => {
			mainChatBtn?.click();
		});
		expect(onBackToMainChat).toHaveBeenCalledTimes(1);

		const openSub1Btn = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Open Sub 1 session"]',
		);
		await act(async () => {
			openSub1Btn?.click();
		});
		expect(onOpenAgentSession).toHaveBeenCalledWith("root__sub_1");
	});

	it("expands a single column and restores all 4 columns on demand", async () => {
		await act(async () => {
			root.render(
				<SubagentColumnsView
					activity={FOUR_ACTIVITY}
					chatTransportState="connected"
					columns={makeFourColumns()}
					onAnswerAskQuestion={vi.fn()}
					onApproveToolApproval={vi.fn()}
					onBackToMainChat={vi.fn()}
					onRejectToolApproval={vi.fn()}
					pendingAskQuestions={[]}
					pendingToolApprovals={[]}
				/>,
			);
		});

		const expandSub2 = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Expand Sub 2"]',
		);
		expect(expandSub2).not.toBeNull();

		await act(async () => {
			expandSub2?.click();
		});

		const zoomedColumns = container.querySelectorAll("[data-subagent-column]");
		expect(zoomedColumns).toHaveLength(1);
		expect(zoomedColumns[0]?.getAttribute("data-subagent-column")).toBe(
			"agent_2",
		);

		const restoreBtn = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Restore all columns"]',
		);
		expect(restoreBtn?.textContent).toContain("All columns (4)");

		await act(async () => {
			restoreBtn?.click();
		});
		expect(container.querySelectorAll("[data-subagent-column]")).toHaveLength(
			4,
		);
	});

	it("routes pending tool approvals only to the matching subagent column", async () => {
		await act(async () => {
			root.render(
				<SubagentColumnsView
					activity={FOUR_ACTIVITY}
					chatTransportState="connected"
					columns={makeFourColumns()}
					onAnswerAskQuestion={vi.fn()}
					onApproveToolApproval={vi.fn()}
					onBackToMainChat={vi.fn()}
					onRejectToolApproval={vi.fn()}
					pendingAskQuestions={[]}
					pendingToolApprovals={[
						{
							requestId: "req-sub-2",
							sessionId: "root-session",
							agentId: "agent_2",
							createdAt: "2026-11-11T00:00:00.000Z",
							toolCallId: "tc-approval",
							toolName: "run_commands",
							input: { commands: ["bun test"] },
						},
					]}
				/>,
			);
		});

		const col1 = container.querySelector('[data-subagent-column="agent_1"]');
		const col2 = container.querySelector('[data-subagent-column="agent_2"]');
		expect(col2?.textContent).toContain("bun test");
		expect(col1?.textContent).not.toContain("bun test");
	});
});
