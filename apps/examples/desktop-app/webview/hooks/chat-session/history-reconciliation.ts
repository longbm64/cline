import type { ChatMessage } from "@/lib/chat-schema";

export function isRealUserTurnMessage(message: ChatMessage): boolean {
	return (
		message.role === "user" &&
		!(
			message.meta?.userRunSpan === 0 &&
			message.content.trimStart().startsWith("[SYSTEM]")
		)
	);
}

export function countUserTurns(messages: ChatMessage[]): number {
	let count = 0;
	for (const message of messages) {
		if (isRealUserTurnMessage(message)) {
			count += 1;
		}
	}
	return count;
}

export function findLastUserTurnIndex(messages: ChatMessage[]): number {
	for (let index = messages.length - 1; index >= 0; index--) {
		if (isRealUserTurnMessage(messages[index])) {
			return index;
		}
	}
	return -1;
}

function hasVisibleAssistantContent(message: ChatMessage): boolean {
	return (
		message.role === "assistant" &&
		Boolean(
			message.content.trim() ||
				message.reasoning?.trim() ||
				message.reasoningRedacted ||
				message.images?.length ||
				message.media?.length,
		)
	);
}

export function hasAssistantInLatestTurn(messages: ChatMessage[]): boolean {
	const start = findLastUserTurnIndex(messages) + 1;
	for (let index = start; index < messages.length; index++) {
		if (messages[index].role === "assistant") {
			return true;
		}
	}
	return false;
}

export function hasTerminalOutputInLatestTurn(
	messages: ChatMessage[],
): boolean {
	const start = findLastUserTurnIndex(messages) + 1;
	for (let index = start; index < messages.length; index++) {
		const message = messages[index];
		if (message.role === "assistant" || message.role === "error") {
			return true;
		}
		if (
			message.role === "tool" &&
			(message.meta?.hookEventName === "history_tool_result" ||
				message.meta?.hookEventName === "tool_call_end")
		) {
			return true;
		}
	}
	return false;
}

function hasStoredRunCount(messages: ChatMessage[]): boolean {
	for (const message of messages) {
		if (
			message.meta?.runCount !== undefined ||
			message.meta?.checkpoint?.runCount !== undefined
		) {
			return true;
		}
	}
	return false;
}

function latestRunCount(messages: ChatMessage[]): number {
	let count = 0;
	for (const message of messages) {
		const stored = message.meta?.runCount ?? message.meta?.checkpoint?.runCount;
		if (stored !== undefined) {
			count = Math.max(count, stored);
		} else if (message.role === "user") {
			count += message.meta?.userRunSpan ?? 1;
		}
	}
	return count;
}

function historyReflectsCurrentTurnTail(
	currentTail: ChatMessage[],
	history: ChatMessage[],
): boolean {
	if (currentTail.length === 0 || history.length === 0) {
		return false;
	}
	const currentTailToolCallIds = new Set<string>();
	for (const message of currentTail) {
		const toolCallId = message.meta?.toolCallId;
		if (toolCallId) {
			currentTailToolCallIds.add(toolCallId);
		}
	}
	if (currentTailToolCallIds.size === 0) {
		return false;
	}
	return history.some((message) => {
		const toolCallId = message.meta?.toolCallId;
		return Boolean(toolCallId && currentTailToolCallIds.has(toolCallId));
	});
}

/** A prior run's persisted failure is not evidence that this run has flushed. */
export function canReplaceFailedTurn(
	current: ChatMessage[],
	history: ChatMessage[],
): boolean {
	const liveError = current.at(-1);
	if (liveError?.role !== "error") return true;
	const savedError = history.at(-1);
	if (savedError?.role !== "error") return false;
	if (latestRunCount(history) < latestRunCount(current)) return false;
	// An earlier failure can share the same text and user-run count (e.g. a
	// continuation without a new prompt). Its stable ID still identifies it.
	return !current.slice(0, -1).some((message) => message.id === savedError.id);
}

/**
 * Guards against overwriting the live multi-turn transcript with a stale
 * persisted snapshot whose latest user prompt or latest turn output has not
 * flushed to disk yet.
 */
export function canApplyCanonicalHistory(
	current: ChatMessage[],
	history: ChatMessage[],
): boolean {
	if (history.length === 0) {
		return current.length === 0;
	}
	if (!canReplaceFailedTurn(current, history)) {
		return false;
	}

	const currentTailStart = findLastUserTurnIndex(current) + 1;
	const historyTailStart = findLastUserTurnIndex(history) + 1;
	const currentTail = current.slice(currentTailStart);
	const historyTail = history.slice(historyTailStart);

	const reflectsCurrentTail = historyReflectsCurrentTurnTail(
		currentTail,
		history,
	);
	if (!reflectsCurrentTail) {
		if (latestRunCount(history) < latestRunCount(current)) {
			return false;
		}
		if (
			!hasStoredRunCount(history) &&
			countUserTurns(history) < countUserTurns(current)
		) {
			return false;
		}
	}

	const liveHasAssistant = currentTail.some(hasVisibleAssistantContent);
	const savedHasAssistantOrError = historyTail.some(
		(message) => message.role === "assistant" || message.role === "error",
	);
	if (liveHasAssistant && !savedHasAssistantOrError) {
		return false;
	}

	const liveHasToolWork = currentTail.some(
		(message) => message.role === "tool",
	);
	const savedHasAnyTurnOutput = historyTail.some(
		(message) =>
			message.role === "assistant" ||
			message.role === "tool" ||
			message.role === "error",
	);
	if (liveHasToolWork && !savedHasAnyTurnOutput) {
		return false;
	}

	return true;
}

function attachClientRenderKey(
	message: ChatMessage,
	renderKey: string,
): ChatMessage {
	if (
		message.meta?.clientRenderKey === renderKey ||
		(!message.meta?.clientRenderKey && message.id === renderKey)
	) {
		return message;
	}
	return {
		...message,
		meta: {
			...message.meta,
			clientRenderKey: renderKey,
		},
	};
}

function indexRealUsersByRun(
	messages: ChatMessage[],
): Array<{ index: number; run: number; message: ChatMessage }> {
	const result: Array<{ index: number; run: number; message: ChatMessage }> =
		[];
	let count = 0;
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		const stored = message.meta?.runCount ?? message.meta?.checkpoint?.runCount;
		if (stored !== undefined) {
			count = Math.max(count, stored);
		} else if (message.role === "user") {
			count += message.meta?.userRunSpan ?? 1;
		}
		if (isRealUserTurnMessage(message)) {
			result.push({ index, run: count, message });
		}
	}
	return result;
}

/**
 * Carries stable client render keys from live user/assistant bubbles onto their
 * canonical counterparts so React updates DOM nodes in place instead of
 * unmounting and remounting bubbles (and breaking MessageScroller anchors).
 */
export function preserveClientRenderKeys(
	current: ChatMessage[],
	history: ChatMessage[],
): ChatMessage[] {
	if (current.length === 0 || history.length === 0) {
		return history;
	}

	const currentUsersByRun = indexRealUsersByRun(current);
	const historyUsersByRun = indexRealUsersByRun(history);

	const keyOverrides = new Map<number, string>();
	if (currentUsersByRun.length > 0 && historyUsersByRun.length > 0) {
		const liveRenderKeyByRun = new Map<number, string>();
		for (const entry of currentUsersByRun) {
			const renderKey = entry.message.meta?.clientRenderKey ?? entry.message.id;
			if (renderKey && !liveRenderKeyByRun.has(entry.run)) {
				liveRenderKeyByRun.set(entry.run, renderKey);
			}
		}
		for (const entry of historyUsersByRun) {
			const renderKey = liveRenderKeyByRun.get(entry.run);
			if (renderKey) {
				keyOverrides.set(entry.index, renderKey);
			}
		}
	}

	const currentTailStart = findLastUserTurnIndex(current) + 1;
	const historyTailStart = findLastUserTurnIndex(history) + 1;
	const liveLatestAssistants = current
		.slice(currentTailStart)
		.filter((message) => message.role === "assistant");
	const historyLatestAssistantIndices: number[] = [];
	for (let index = historyTailStart; index < history.length; index++) {
		if (history[index].role === "assistant") {
			historyLatestAssistantIndices.push(index);
		}
	}
	const assistantPairCount = Math.min(
		liveLatestAssistants.length,
		historyLatestAssistantIndices.length,
	);
	for (let i = 0; i < assistantPairCount; i++) {
		const liveAssistant =
			liveLatestAssistants[
				liveLatestAssistants.length - assistantPairCount + i
			];
		const targetHistoryIndex =
			historyLatestAssistantIndices[
				historyLatestAssistantIndices.length - assistantPairCount + i
			];
		const renderKey = liveAssistant.meta?.clientRenderKey ?? liveAssistant.id;
		if (targetHistoryIndex !== undefined && renderKey) {
			keyOverrides.set(targetHistoryIndex, renderKey);
		}
	}

	if (keyOverrides.size === 0) {
		return history;
	}

	let mutated = false;
	const next = history.map((message, index) => {
		const renderKey = keyOverrides.get(index);
		if (!renderKey) {
			return message;
		}
		const updated = attachClientRenderKey(message, renderKey);
		if (updated !== message) {
			mutated = true;
		}
		return updated;
	});

	return mutated ? next : history;
}
