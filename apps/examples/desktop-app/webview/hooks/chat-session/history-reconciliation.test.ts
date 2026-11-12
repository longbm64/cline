import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	canApplyCanonicalHistory,
	canReplaceFailedTurn,
	hasAssistantInLatestTurn,
	hasTerminalOutputInLatestTurn,
	preserveClientRenderKeys,
} from "./history-reconciliation";

const row = (
	id: string,
	role: ChatMessage["role"],
	runCount?: number,
): ChatMessage => ({
	id,
	role,
	sessionId: "s",
	content: "same text",
	createdAt: 1,
	meta: runCount ? { runCount } : undefined,
});

describe("failed turn history reconciliation", () => {
	it("rejects an earlier error while a repeated prompt has a new live failure", () => {
		const old = [row("u1", "user", 4), row("e1", "error", 4)];
		const current = [
			...old,
			row("u2", "user"),
			row("partial", "assistant"),
			row("tool", "tool"),
			row("live", "error"),
		];
		expect(canReplaceFailedTurn(current, old)).toBe(false);
		expect(canReplaceFailedTurn(current, [...old, row("u2", "user", 5)])).toBe(
			false,
		);
		expect(
			canReplaceFailedTurn(current, [
				...old,
				row("u2", "user", 5),
				row("e2", "error", 5),
			]),
		).toBe(true);
	});
	it("rejects an earlier error ID even for a continuation in the same user run", () => {
		const old = [row("u1", "user"), row("e1", "error")];
		expect(canReplaceFailedTurn([...old, row("live", "error")], old)).toBe(
			false,
		);
	});
});

describe("multi-turn canonical history guards", () => {
	it("rejects stale Turn 1 history when Turn 2 prompt or reply is already live", () => {
		const turn1Saved: ChatMessage[] = [
			{ ...row("msg_1", "user"), content: "First prompt" },
			{ ...row("msg_2", "assistant"), content: "First reply" },
		];
		const turn2LivePromptOnly: ChatMessage[] = [
			...turn1Saved,
			{
				...row("user_live_2", "user"),
				content: "Second prompt",
				meta: { clientRenderKey: "user_live_2" },
			},
		];
		const turn2LiveWithReply: ChatMessage[] = [
			...turn2LivePromptOnly,
			{
				...row("assistant_live_2", "assistant"),
				content: "Second reply",
				meta: { clientRenderKey: "assistant_live_2" },
			},
		];

		// Stale disk snapshot missing Turn 2's user prompt completely
		expect(canApplyCanonicalHistory(turn2LivePromptOnly, turn1Saved)).toBe(
			false,
		);
		expect(canApplyCanonicalHistory(turn2LiveWithReply, turn1Saved)).toBe(
			false,
		);

		// Disk flushed Turn 2's user prompt, but not Turn 2's assistant reply yet
		const turn2HalfSaved: ChatMessage[] = [
			...turn1Saved,
			{ ...row("msg_3", "user"), content: "Second prompt" },
		];
		expect(hasAssistantInLatestTurn(turn2HalfSaved)).toBe(false);
		expect(canApplyCanonicalHistory(turn2LiveWithReply, turn2HalfSaved)).toBe(
			false,
		);

		// Disk flushed Turn 2's assistant reply: safe to reconcile and preserves clientRenderKey
		const turn2FullySaved: ChatMessage[] = [
			...turn2HalfSaved,
			{ ...row("msg_4", "assistant"), content: "Second reply" },
		];
		expect(hasAssistantInLatestTurn(turn2FullySaved)).toBe(true);
		expect(canApplyCanonicalHistory(turn2LiveWithReply, turn2FullySaved)).toBe(
			true,
		);

		const reconciled = preserveClientRenderKeys(
			turn2LiveWithReply,
			turn2FullySaved,
		);
		expect(reconciled[2]?.id).toBe("msg_3");
		expect(reconciled[2]?.meta?.clientRenderKey).toBe("user_live_2");
		expect(reconciled[3]?.id).toBe("msg_4");
		expect(reconciled[3]?.meta?.clientRenderKey).toBe("assistant_live_2");
	});

	it("accepts aborted tool-only canonical history when it reflects the active toolCallId", () => {
		const liveAbortedTurn: ChatMessage[] = [
			{ ...row("user_live_1", "user"), content: "spawn a subagent" },
			{
				...row("tool_live_1", "tool"),
				meta: {
					toolName: "spawn_agent",
					toolCallId: "call-spawn",
					hookEventName: "tool_call_start",
				},
			},
		];
		const persistedToolOnly: ChatMessage[] = [
			{
				...row("history-tool", "tool"),
				meta: {
					toolName: "spawn_agent",
					toolCallId: "call-spawn",
					hookEventName: "history_tool_result",
				},
			},
		];
		expect(hasTerminalOutputInLatestTurn(persistedToolOnly)).toBe(true);
		expect(canApplyCanonicalHistory(liveAbortedTurn, persistedToolOnly)).toBe(
			true,
		);
	});

	it("preserves clientRenderKey by monotonic runCount when MAX_MESSAGES truncates older head turns", () => {
		const liveWindow: ChatMessage[] = [
			{ ...row("hist_u10", "user", 10), content: "Prompt 10" },
			{ ...row("hist_a10", "assistant", 10), content: "Reply 10" },
			{ ...row("hist_u11", "user", 11), content: "Prompt 11" },
			{ ...row("hist_a11", "assistant", 11), content: "Reply 11" },
			{
				...row("opt_u12", "user"),
				content: "Prompt 12",
				meta: { clientRenderKey: "opt_u12" },
			},
			{
				...row("stream_a12", "assistant"),
				content: "Reply 12",
				meta: { clientRenderKey: "stream_a12" },
			},
		];
		// Turn 10 fell off the MAX_MESSAGES window head when Turn 12 flushed
		const truncatedHistoryWindow: ChatMessage[] = [
			{ ...row("hist_u11", "user", 11), content: "Prompt 11" },
			{ ...row("hist_a11", "assistant", 11), content: "Reply 11" },
			{ ...row("hist_u12", "user", 12), content: "Prompt 12" },
			{ ...row("hist_a12", "assistant", 12), content: "Reply 12" },
		];
		expect(
			canApplyCanonicalHistory(liveWindow, truncatedHistoryWindow),
		).toBe(true);
		const reconciled = preserveClientRenderKeys(
			liveWindow,
			truncatedHistoryWindow,
		);
		expect(reconciled[2]?.id).toBe("hist_u12");
		expect(reconciled[2]?.meta?.clientRenderKey).toBe("opt_u12");
		expect(reconciled[3]?.id).toBe("hist_a12");
		expect(reconciled[3]?.meta?.clientRenderKey).toBe("stream_a12");
	});
});
