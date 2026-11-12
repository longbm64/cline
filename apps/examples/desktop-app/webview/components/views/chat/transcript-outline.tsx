"use client";

import {
	useMessageScroller,
	useMessageScrollerVisibility,
} from "@cline/ui/components/message-scroller";
import {
	memo,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
} from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChatMessage } from "@/lib/chat-schema";
import { formatChatMessageContent } from "./message-content";
import { isSystemSteeringMessage } from "./messages/group-messages";

export function TranscriptOutline({
	messages,
	onEnsureMessageRendered,
}: {
	messages: ChatMessage[];
	onEnsureMessageRendered?: (messageId: string) => boolean;
}) {
	const { scrollToMessage } = useMessageScroller();
	const { currentAnchorId } = useMessageScrollerVisibility();
	const outlineRef = useRef<HTMLElement>(null);
	const currentButtonRef = useRef<HTMLButtonElement>(null);
	const pendingJumpFrameRef = useRef<number | null>(null);
	const prevUserMessagesRef = useRef<ChatMessage[]>([]);

	useEffect(() => {
		return () => {
			if (pendingJumpFrameRef.current !== null) {
				window.cancelAnimationFrame(pendingJumpFrameRef.current);
				pendingJumpFrameRef.current = null;
			}
		};
	}, []);

	const navigateToMessage = useCallback(
		(messageId: string) => {
			const didExpandWindow = onEnsureMessageRendered?.(messageId) ?? false;
			if (!didExpandWindow) {
				scrollToMessage(messageId, {
					align: "start",
					behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
						.matches
						? "instant"
						: "smooth",
				});
				return;
			}
			// Wait one animation frame for newly revealed older transcript items to
			// register with MessageScroller, then jump directly to avoid smooth-
			// scrolling across a freshly mounted multi-screen span.
			if (pendingJumpFrameRef.current !== null) {
				window.cancelAnimationFrame(pendingJumpFrameRef.current);
			}
			pendingJumpFrameRef.current = window.requestAnimationFrame(() => {
				pendingJumpFrameRef.current = null;
				scrollToMessage(messageId, {
					align: "start",
					behavior: "instant",
				});
			});
		},
		[onEnsureMessageRendered, scrollToMessage],
	);
	const userMessages = useMemo(() => {
		const filtered = messages.filter(
			(message) =>
				message.role === "user" && !isSystemSteeringMessage(message),
		);
		const prev = prevUserMessagesRef.current;
		if (
			prev.length === filtered.length &&
			filtered.every((item, idx) => item === prev[idx])
		) {
			return prev;
		}
		prevUserMessagesRef.current = filtered;
		return filtered;
	}, [messages]);
	// Change only the outline's scroll offset; scrollIntoView could also move
	// the transcript or the page. No layout reads are needed on stream flushes.
	useEffect(() => {
		if (!currentAnchorId || userMessages.length === 0) return;
		const outline = outlineRef.current;
		const button = currentButtonRef.current;
		if (!outline || !button) return;
		const outlineBounds = outline.getBoundingClientRect();
		const buttonBounds = button.getBoundingClientRect();
		const top = outlineBounds.top + outline.clientTop;
		const bottom = top + outline.clientHeight;
		if (buttonBounds.top < top) {
			outline.scrollTop += buttonBounds.top - top;
		} else if (buttonBounds.bottom > bottom) {
			outline.scrollTop += buttonBounds.bottom - bottom;
		}
	}, [currentAnchorId, userMessages.length]);

	if (userMessages.length === 0) return null;
	return (
		<nav
			ref={outlineRef}
			aria-label="Transcript outline"
			className="absolute left-2 top-1/2 z-10 flex max-h-[calc(100%-3rem)] -translate-y-1/2 flex-col overflow-y-auto rounded-md bg-background/90 p-1"
		>
			{userMessages.map((message, index) => (
				<TranscriptOutlineEntry
					key={message.id}
					messageId={message.id}
					content={message.content}
					hasImages={Boolean(message.images?.length)}
					index={index}
					isCurrent={currentAnchorId === message.id}
					currentButtonRef={currentButtonRef}
					onNavigate={navigateToMessage}
				/>
			))}
		</nav>
	);
}

// Primitive props keep unchanged entries memoized even when history hydration
// replaces message objects. Preview work runs only when the prompt changes.
const TranscriptOutlineEntry = memo(function TranscriptOutlineEntry({
	messageId,
	content,
	hasImages,
	index,
	isCurrent,
	currentButtonRef,
	onNavigate,
}: {
	messageId: string;
	content: string;
	hasImages: boolean;
	index: number;
	isCurrent: boolean;
	currentButtonRef: RefObject<HTMLButtonElement | null>;
	onNavigate: (messageId: string) => void;
}) {
	const preview = useMemo(
		() =>
			formatChatMessageContent("user", content).replace(/\s+/g, " ") ||
			(hasImages ? "Image attachment" : "User message"),
		[content, hasImages],
	);
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					ref={isCurrent ? currentButtonRef : undefined}
					type="button"
					aria-label={`Go to message ${index + 1}: ${preview.slice(0, 120)}`}
					aria-current={isCurrent ? "location" : undefined}
					className="group flex h-4 w-7 shrink-0 items-center justify-start rounded-sm px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={() => onNavigate(messageId)}
				>
					<span className="h-0.5 w-4 rounded-full bg-muted-foreground/40 transition-[width,background-color] duration-150 ease-out group-hover:w-5 group-hover:bg-foreground group-focus-visible:w-5 group-focus-visible:bg-foreground group-aria-[current=location]:w-5 group-aria-[current=location]:bg-foreground motion-reduce:transition-none" />
				</button>
			</TooltipTrigger>
			<TooltipContent
				side="right"
				sideOffset={8}
				variant="surface"
				className="max-w-64"
			>
				<span className="line-clamp-3">{preview}</span>
			</TooltipContent>
		</Tooltip>
	);
});
