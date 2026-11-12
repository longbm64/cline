// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	type ChatRenderItem,
	collapseCompletedWork,
	groupChatMessages,
} from "./group-messages";
import {
	alignWindowStartIndex,
	findRenderItemIndexContainingMessage,
	INITIAL_RENDER_ITEM_COUNT,
	LOAD_OLDER_BATCH_SIZE,
	useProgressiveRenderWindow,
} from "./use-progressive-render-window";

function makeMessage(
	id: string,
	role: "user" | "assistant" | "tool",
	content: string,
	createdAt: number,
): ChatMessage {
	return {
		id,
		sessionId: "session-1",
		role,
		content,
		createdAt,
	};
}

function buildConversationRenderItems(turnCount: number): ChatRenderItem[] {
	const messages: ChatMessage[] = [];
	for (let turn = 0; turn < turnCount; turn++) {
		messages.push(
			makeMessage(`user-${turn}`, "user", `Question ${turn}`, turn * 10 + 1),
		);
		messages.push(
			makeMessage(
				`tool-${turn}`,
				"tool",
				JSON.stringify({
					toolName: "read_files",
					input: { paths: [`file-${turn}.ts`] },
					result: { content: "ok" },
				}),
				turn * 10 + 2,
			),
		);
		messages.push(
			makeMessage(
				`assistant-${turn}`,
				"assistant",
				`Answer ${turn}`,
				turn * 10 + 5,
			),
		);
	}
	return collapseCompletedWork(groupChatMessages(messages), {
		collapseTrailingRun: true,
	});
}

describe("alignWindowStartIndex", () => {
	it("never slices between a folded work block and its assistant answer", () => {
		const items = buildConversationRenderItems(5);
		// Each turn produces 3 renderItems: user (0), work (1), assistant (2).
		expect(items[1]?.type).toBe("work");
		expect(items[2]?.type).toBe("message");

		// Landing on assistant (index 2) pulls back to include its work block (index 1).
		expect(alignWindowStartIndex(items, 2)).toBe(1);
		// Landing on user (index 3) stays at index 3.
		expect(alignWindowStartIndex(items, 3)).toBe(3);
	});
});

describe("findRenderItemIndexContainingMessage", () => {
	it("locates top-level user/assistant messages and nested work tool messages", () => {
		const items = buildConversationRenderItems(4);
		expect(findRenderItemIndexContainingMessage(items, "user-0")).toBe(0);
		expect(findRenderItemIndexContainingMessage(items, "tool-2")).toBe(7);
		expect(findRenderItemIndexContainingMessage(items, "assistant-3")).toBe(11);
		expect(findRenderItemIndexContainingMessage(items, "missing")).toBe(-1);
	});
});

describe("useProgressiveRenderWindow", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.restoreAllMocks();
	});

	it("mounts only the tail window on long histories and prepends batches smoothly", async () => {
		const allItems = buildConversationRenderItems(30); // 90 render items
		let latestApi: ReturnType<typeof useProgressiveRenderWindow> | null = null;

		function Harness({
			items,
			sessionId,
		}: {
			items: ChatRenderItem[];
			sessionId: string;
		}) {
			const api = useProgressiveRenderWindow({
				sessionId,
				renderItems: items,
			});
			latestApi = api;
			return (
				<div
					data-testid="viewport"
					onScroll={api.handleViewportScroll}
					ref={api.viewportRef}
				>
					{api.renderedItems.map((item, idx) => {
						const realIdx = api.renderedStartIndex + idx;
						const id =
							item.type === "message" ? item.message.id : `work_${item.id}`;
						return (
							<div data-message-id={id} data-real-index={realIdx} key={id}>
								{id}
							</div>
						);
					})}
				</div>
			);
		}

		await act(async () => {
			root.render(<Harness items={allItems} sessionId="session-1" />);
		});

		expect(latestApi).not.toBeNull();
		const initialStart = latestApi!.renderedStartIndex;
		expect(initialStart).toBeGreaterThanOrEqual(
			allItems.length - INITIAL_RENDER_ITEM_COUNT - 1,
		);
		expect(latestApi!.hasOlderItems).toBe(true);

		// Appending a new turn at the tail keeps the same top anchor without unmounting or shifting startIndex.
		const grownItems = buildConversationRenderItems(31);
		await act(async () => {
			root.render(<Harness items={grownItems} sessionId="session-1" />);
		});
		expect(latestApi!.renderedStartIndex).toBe(initialStart);

		// Prepending one batch moves startIndex up by ~LOAD_OLDER_BATCH_SIZE.
		await act(async () => {
			latestApi!.loadOlderBatch();
		});
		expect(latestApi!.renderedStartIndex).toBeLessThanOrEqual(
			initialStart - LOAD_OLDER_BATCH_SIZE,
		);

		// Jumping to the very oldest prompt expands the window all the way to index 0.
		await act(async () => {
			const expanded = latestApi!.ensureMessageRendered("user-0");
			expect(expanded).toBe(true);
		});
		expect(latestApi!.renderedStartIndex).toBe(0);
		expect(latestApi!.hasOlderItems).toBe(false);

		// Switching sessions resets the window cleanly back to the new session's tail.
		await act(async () => {
			root.render(<Harness items={allItems} sessionId="session-2" />);
		});
		expect(latestApi!.renderedStartIndex).toBe(initialStart);
		expect(latestApi!.hasOlderItems).toBe(true);
	});
});
