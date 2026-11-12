"use client";

import {
	type RefObject,
	type UIEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ChatRenderItem } from "./group-messages";

/**
 * Number of grouped transcript items mounted initially when opening a long
 * session. Short sessions (`<= INITIAL_RENDER_ITEM_COUNT`) mount in full.
 */
export const INITIAL_RENDER_ITEM_COUNT = 28;

/** Number of older grouped transcript items prepended per upward scroll step. */
export const LOAD_OLDER_BATCH_SIZE = 20;

/**
 * Distance from the top of the scroll viewport (in px) at which the next batch
 * of older items is prepended, well before momentum scrolling hits `scrollTop = 0`.
 */
export const LOAD_OLDER_SCROLL_THRESHOLD_PX = 720;

const TOP_EDGE_TRIGGER_PX = 16;
const MIN_SCROLLABLE_BUFFER_PX = 120;

type WindowAnchor =
	| { kind: "uninitialized" }
	| { kind: "all" }
	| { kind: "item"; itemId: string; fallbackTailCount: number };

type WindowState = {
	sessionKey: string;
	anchor: WindowAnchor;
};

type SavedViewportAnchor = {
	element: HTMLElement;
	offsetTop: number;
};

export type UseProgressiveRenderWindowOptions = {
	sessionId: string | null;
	/**
	 * Stable key across an optimistic new-chat send (`null -> sessionId`) so the
	 * scroller and render window never tear down or flash hidden when the server
	 * assigns the first session ID.
	 */
	conversationKey?: string;
	renderItems: readonly ChatRenderItem[];
	initialCount?: number;
	batchSize?: number;
	scrollThresholdPx?: number;
};

export type ProgressiveRenderWindowResult = {
	renderedItems: ChatRenderItem[];
	renderedStartIndex: number;
	hasOlderItems: boolean;
	viewportRef: RefObject<HTMLDivElement | null>;
	handleViewportScroll: (event: UIEvent<HTMLDivElement>) => void;
	loadOlderBatch: () => boolean;
	ensureMessageRendered: (messageId: string) => boolean;
};

/**
 * Keeps a single stable mount/window key when a new chat transitions from
 * `sessionId === null` (optimistic first message) to its newly created
 * `sessionId`, while still rotating keys whenever switching between distinct
 * sessions, opening a saved session from an empty welcome screen, or resetting
 * back to a fresh chat.
 */
export function useStableConversationKey(
	sessionId: string | null,
	hasMessages: boolean,
): string {
	const stateRef = useRef<{
		prevSessionId: string | null;
		hadMessagesWhileNull: boolean;
		generation: number;
		key: string;
	} | null>(null);

	if (stateRef.current === null) {
		stateRef.current = {
			prevSessionId: sessionId,
			hadMessagesWhileNull: sessionId === null && hasMessages,
			generation: 0,
			key: sessionId ?? "__new_chat_0__",
		};
		return stateRef.current.key;
	}

	const state = stateRef.current;
	if (sessionId === null) {
		if (state.prevSessionId !== null) {
			state.prevSessionId = null;
			state.hadMessagesWhileNull = hasMessages;
			state.generation += 1;
			state.key = `__new_chat_${state.generation}__`;
		} else if (hasMessages) {
			state.hadMessagesWhileNull = true;
		}
		return state.key;
	}

	if (state.prevSessionId === null && state.hadMessagesWhileNull) {
		// Optimistic first turn just received its server session ID: keep the
		// existing key so MessageScrollerProvider and the window never remount.
		state.prevSessionId = sessionId;
		state.hadMessagesWhileNull = false;
		return state.key;
	}

	if (state.prevSessionId !== sessionId) {
		state.prevSessionId = sessionId;
		state.hadMessagesWhileNull = false;
		state.key = sessionId;
	}

	return state.key;
}

export function getRenderItemId(item: ChatRenderItem): string {
	if (item.type === "tools") {
		return `tools_${item.messages[0]?.id ?? "empty"}`;
	}
	if (item.type === "run" || item.type === "work") {
		return `work_${item.id}`;
	}
	return item.message.meta?.clientRenderKey ?? item.message.id;
}

/**
 * Keeps an assistant reply paired with its immediately preceding working block
 * (`work`, `run`, or `tools`) so window boundaries never slice mid-turn.
 */
export function alignWindowStartIndex(
	items: readonly ChatRenderItem[],
	rawIndex: number,
): number {
	if (items.length === 0 || rawIndex <= 0) {
		return 0;
	}
	let index = Math.min(rawIndex, items.length - 1);
	while (index > 0) {
		const current = items[index];
		const previous = items[index - 1];
		if (
			current?.type === "message" &&
			current.message.role === "assistant" &&
			previous !== undefined &&
			previous.type !== "message"
		) {
			index -= 1;
			continue;
		}
		break;
	}
	return index;
}

function renderItemContainsMessage(
	item: ChatRenderItem,
	messageId: string,
): boolean {
	if (item.type === "message") {
		return (
			item.message.id === messageId ||
			item.reasoningMessages.some((message) => message.id === messageId)
		);
	}
	if (item.type === "tools") {
		return item.messages.some((message) => message.id === messageId);
	}
	return item.items.some((child) =>
		renderItemContainsMessage(child, messageId),
	);
}

export function findRenderItemIndexContainingMessage(
	items: readonly ChatRenderItem[],
	messageId: string,
): number {
	for (let index = 0; index < items.length; index++) {
		const item = items[index];
		if (item && renderItemContainsMessage(item, messageId)) {
			return index;
		}
	}
	return -1;
}

function resolveWindowState(
	currentState: WindowState,
	sessionKey: string,
	renderItems: readonly ChatRenderItem[],
	itemIds: readonly string[],
	indexById: ReadonlyMap<string, number>,
	initialCount: number,
): { startIndex: number; resolvedState: WindowState } {
	const effectiveAnchor: WindowAnchor =
		currentState.sessionKey === sessionKey
			? currentState.anchor
			: { kind: "uninitialized" };

	if (renderItems.length === 0) {
		return {
			startIndex: 0,
			resolvedState: {
				sessionKey,
				anchor: { kind: "uninitialized" },
			},
		};
	}

	if (effectiveAnchor.kind === "all") {
		return {
			startIndex: 0,
			resolvedState: {
				sessionKey,
				anchor: { kind: "all" },
			},
		};
	}

	if (effectiveAnchor.kind === "uninitialized") {
		if (renderItems.length <= initialCount) {
			return {
				startIndex: 0,
				resolvedState: {
					sessionKey,
					anchor: { kind: "all" },
				},
			};
		}
		const startIndex = alignWindowStartIndex(
			renderItems,
			renderItems.length - initialCount,
		);
		if (startIndex === 0) {
			return {
				startIndex: 0,
				resolvedState: {
					sessionKey,
					anchor: { kind: "all" },
				},
			};
		}
		return {
			startIndex,
			resolvedState: {
				sessionKey,
				anchor: {
					kind: "item",
					itemId: itemIds[startIndex] ?? "",
					fallbackTailCount: renderItems.length - startIndex,
				},
			},
		};
	}

	const matchedIndex = indexById.get(effectiveAnchor.itemId);
	const startIndex =
		matchedIndex !== undefined
			? matchedIndex
			: alignWindowStartIndex(
					renderItems,
					Math.max(
						0,
						renderItems.length -
							Math.max(initialCount, effectiveAnchor.fallbackTailCount),
					),
				);

	if (startIndex <= 0) {
		return {
			startIndex: 0,
			resolvedState: {
				sessionKey,
				anchor: { kind: "all" },
			},
		};
	}

	return {
		startIndex,
		resolvedState: {
			sessionKey,
			anchor: {
				kind: "item",
				itemId: itemIds[startIndex] ?? "",
				fallbackTailCount: renderItems.length - startIndex,
			},
		},
	};
}

function windowStatesEqual(a: WindowState, b: WindowState): boolean {
	if (a.sessionKey !== b.sessionKey || a.anchor.kind !== b.anchor.kind) {
		return false;
	}
	if (a.anchor.kind === "item" && b.anchor.kind === "item") {
		return (
			a.anchor.itemId === b.anchor.itemId &&
			a.anchor.fallbackTailCount === b.anchor.fallbackTailCount
		);
	}
	return true;
}

function captureFirstVisibleAnchor(
	viewport: HTMLElement,
): SavedViewportAnchor | null {
	const viewportTop = viewport.getBoundingClientRect().top;
	const candidates =
		viewport.querySelectorAll<HTMLElement>("[data-message-id]");
	for (const element of candidates) {
		const rect = element.getBoundingClientRect();
		if (rect.bottom > viewportTop) {
			return {
				element,
				offsetTop: rect.top - viewportTop,
			};
		}
	}
	return null;
}

/**
 * Progressively mounts older chat transcript items as the user scrolls upward,
 * keeping initial DOM/Markdown/Shiki cost bounded to the latest turns while
 * preserving exact viewport scroll offset on every prepended batch.
 */
export function useProgressiveRenderWindow({
	sessionId,
	conversationKey,
	renderItems,
	initialCount = INITIAL_RENDER_ITEM_COUNT,
	batchSize = LOAD_OLDER_BATCH_SIZE,
	scrollThresholdPx = LOAD_OLDER_SCROLL_THRESHOLD_PX,
}: UseProgressiveRenderWindowOptions): ProgressiveRenderWindowResult {
	const fallbackConversationKey = useStableConversationKey(
		sessionId,
		renderItems.length > 0,
	);
	const sessionKey = conversationKey ?? fallbackConversationKey;
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const lastScrollTopRef = useRef<number>(0);
	const lastSessionKeyRef = useRef<string>(sessionKey);
	const lastTotalItemCountRef = useRef<number>(renderItems.length);
	const tailAppendedSinceScrollRef = useRef<boolean>(false);
	if (lastTotalItemCountRef.current !== renderItems.length) {
		if (renderItems.length > lastTotalItemCountRef.current) {
			tailAppendedSinceScrollRef.current = true;
		}
		lastTotalItemCountRef.current = renderItems.length;
	}
	const scrollLoadFrameRef = useRef<number | null>(null);
	const pendingPrependAnchorRef = useRef<SavedViewportAnchor | null>(null);

	const [windowState, setWindowState] = useState<WindowState>(() => ({
		sessionKey,
		anchor: { kind: "uninitialized" },
	}));

	const { itemIds, indexById } = useMemo(() => {
		const ids = renderItems.map(getRenderItemId);
		const map = new Map<string, number>();
		for (let index = 0; index < ids.length; index++) {
			const id = ids[index];
			if (id !== undefined && !map.has(id)) {
				map.set(id, index);
			}
		}
		return { itemIds: ids, indexById: map };
	}, [renderItems]);

	const { startIndex: renderedStartIndex, resolvedState } = useMemo(
		() =>
			resolveWindowState(
				windowState,
				sessionKey,
				renderItems,
				itemIds,
				indexById,
				initialCount,
			),
		[windowState, sessionKey, renderItems, itemIds, indexById, initialCount],
	);

	const renderedItems = useMemo(
		() =>
			renderedStartIndex === 0
				? (renderItems as ChatRenderItem[])
				: renderItems.slice(renderedStartIndex),
		[renderItems, renderedStartIndex],
	);

	const latestRef = useRef({
		sessionKey,
		renderItems,
		itemIds,
		renderedStartIndex,
	});
	latestRef.current = {
		sessionKey,
		renderItems,
		itemIds,
		renderedStartIndex,
	};

	const prevStartIndexRef = useRef<number>(renderedStartIndex);

	useLayoutEffect(() => {
		if (!windowStatesEqual(windowState, resolvedState)) {
			setWindowState(resolvedState);
		}
	}, [windowState, resolvedState]);

	const applyStartIndex = useCallback(
		(nextRawStartIndex: number, preserveScrollPosition: boolean): boolean => {
			const {
				sessionKey: activeKey,
				renderItems: currentItems,
				itemIds: currentIds,
				renderedStartIndex: currentStart,
			} = latestRef.current;
			if (currentStart <= 0 || currentItems.length === 0) {
				return false;
			}
			const nextStart = alignWindowStartIndex(
				currentItems,
				Math.max(0, nextRawStartIndex),
			);
			if (nextStart >= currentStart) {
				return false;
			}
			if (preserveScrollPosition && viewportRef.current) {
				pendingPrependAnchorRef.current = captureFirstVisibleAnchor(
					viewportRef.current,
				);
			}
			setWindowState({
				sessionKey: activeKey,
				anchor:
					nextStart === 0
						? { kind: "all" }
						: {
								kind: "item",
								itemId: currentIds[nextStart] ?? "",
								fallbackTailCount: currentItems.length - nextStart,
							},
			});
			return true;
		},
		[],
	);

	const loadOlderBatch = useCallback((): boolean => {
		const { renderedStartIndex: currentStart } = latestRef.current;
		if (currentStart <= 0) {
			return false;
		}
		return applyStartIndex(currentStart - batchSize, true);
	}, [applyStartIndex, batchSize]);

	const ensureMessageRendered = useCallback(
		(messageId: string): boolean => {
			const { renderItems: currentItems, renderedStartIndex: currentStart } =
				latestRef.current;
			if (currentStart <= 0) {
				return false;
			}
			const targetIndex = findRenderItemIndexContainingMessage(
				currentItems,
				messageId,
			);
			if (targetIndex < 0 || targetIndex >= currentStart) {
				return false;
			}
			// Include two preceding items so MessageScroller's previous-item peek
			// has surrounding context immediately above the target user prompt.
			return applyStartIndex(targetIndex - 2, true);
		},
		[applyStartIndex],
	);

	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		if (lastSessionKeyRef.current !== sessionKey) {
			lastSessionKeyRef.current = sessionKey;
			prevStartIndexRef.current = renderedStartIndex;
			pendingPrependAnchorRef.current = null;
			if (scrollLoadFrameRef.current !== null) {
				window.cancelAnimationFrame(scrollLoadFrameRef.current);
				scrollLoadFrameRef.current = null;
			}
			lastScrollTopRef.current = viewport?.scrollTop ?? 0;
			return;
		}

		const prevStart = prevStartIndexRef.current;
		prevStartIndexRef.current = renderedStartIndex;
		const savedAnchor = pendingPrependAnchorRef.current;
		pendingPrependAnchorRef.current = null;

		if (!viewport) {
			return;
		}

		if (
			renderedStartIndex < prevStart &&
			savedAnchor &&
			savedAnchor.element.isConnected
		) {
			const currentOffsetTop =
				savedAnchor.element.getBoundingClientRect().top -
				viewport.getBoundingClientRect().top;
			const delta = currentOffsetTop - savedAnchor.offsetTop;
			if (Math.abs(delta) > 0.5) {
				viewport.scrollTop += delta;
			}
			lastScrollTopRef.current = viewport.scrollTop;
		} else {
			lastScrollTopRef.current = viewport.scrollTop;
		}

		// In a real laid-out viewport, if the initial items are too compact to
		// make the container scrollable (e.g. tall display + short messages),
		// pull another batch so the user can actually scroll upward.
		if (
			renderedStartIndex > 0 &&
			viewport.clientHeight > 0 &&
			viewport.scrollHeight <= viewport.clientHeight + MIN_SCROLLABLE_BUFFER_PX
		) {
			const frame = window.requestAnimationFrame(() => {
				loadOlderBatch();
			});
			return () => window.cancelAnimationFrame(frame);
		}
	}, [sessionKey, renderedStartIndex, loadOlderBatch]);

	useEffect(() => {
		return () => {
			if (scrollLoadFrameRef.current !== null) {
				window.cancelAnimationFrame(scrollLoadFrameRef.current);
				scrollLoadFrameRef.current = null;
			}
		};
	}, []);

	const handleViewportScroll = useCallback(
		(_event: UIEvent<HTMLDivElement>) => {
			const viewport = viewportRef.current;
			if (!viewport) {
				return;
			}
			const currentScrollTop = viewport.scrollTop;
			const previousScrollTop = lastScrollTopRef.current;
			lastScrollTopRef.current = currentScrollTop;

			if (tailAppendedSinceScrollRef.current) {
				tailAppendedSinceScrollRef.current = false;
				if (currentScrollTop >= previousScrollTop) {
					return;
				}
			}

			if (latestRef.current.renderedStartIndex <= 0) {
				return;
			}

			const isScrollingUp = currentScrollTop < previousScrollTop;
			const isAtTopEdgeIdle =
				currentScrollTop <= TOP_EDGE_TRIGGER_PX &&
				!viewport.hasAttribute("data-autoscrolling");
			if (
				(!isScrollingUp && !isAtTopEdgeIdle) ||
				currentScrollTop > scrollThresholdPx ||
				scrollLoadFrameRef.current !== null
			) {
				return;
			}

			scrollLoadFrameRef.current = window.requestAnimationFrame(() => {
				scrollLoadFrameRef.current = null;
				loadOlderBatch();
			});
		},
		[loadOlderBatch, scrollThresholdPx],
	);

	return {
		renderedItems,
		renderedStartIndex,
		hasOlderItems: renderedStartIndex > 0,
		viewportRef,
		handleViewportScroll,
		loadOlderBatch,
		ensureMessageRendered,
	};
}
