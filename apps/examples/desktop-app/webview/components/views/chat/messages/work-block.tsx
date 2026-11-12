"use client";

import {
	WorkActivity,
	WorkActivityContent,
	WorkActivityTrigger,
} from "@cline/ui/components/agent-chat";
import { memo, type ReactNode, useState } from "react";
import type { ChatMessage, ChatMessageImage } from "@/lib/chat-schema";
import {
	type ChatRenderItem,
	getThoughtDurationMilliseconds,
} from "./group-messages";
import { MessageBubble } from "./message-bubble";
import { ToolMessageBlock } from "./tool-message-block";

type WorkBlockProps = {
	durationMilliseconds?: number;
	toolCallCount: number;
	items?: ChatRenderItem[];
	copiedChildMessageId?: string | null;
	previousTimestampByMessage?: ReadonlyMap<ChatMessage, number | undefined>;
	turnCompletionDurationByMessageId?: ReadonlyMap<string, number>;
	onCopyMessage?: (messageId: string, text: string) => void | Promise<void>;
	onExpandImage?: (image: ChatMessageImage) => void;
	onProceedWhileRunning?: (
		sessionId: string,
		toolCallId?: string,
	) => void | Promise<void>;
	children?: ReactNode;
};

/**
 * Collapsed summary row for a finished run's working rows. Expanding re-shows
 * the run's normal chat rows (tool calls, thinking traces, narration) under
 * the shared disclosure rail. Collapse state lives in the ui primitive, so
 * keying this block by the work item's stable id preserves it across renders.
 *
 * Child rows are constructed lazily on first expand so scrolling upward across
 * dozens of historical turns does not allocate collapsed tool/reasoning trees.
 */
export const WorkBlock = memo(
	function WorkBlock({
		durationMilliseconds,
		toolCallCount,
		items,
		copiedChildMessageId = null,
		previousTimestampByMessage,
		turnCompletionDurationByMessageId,
		onCopyMessage,
		onExpandImage,
		onProceedWhileRunning,
		children,
	}: WorkBlockProps) {
		const [hasOpened, setHasOpened] = useState(false);

		const renderWorkingItem = (child: ChatRenderItem) => {
			if (child.type === "tools") {
				return (
					<ToolMessageBlock
						isRunActive={false}
						key={`tools_${child.messages[0]?.id ?? "empty"}`}
						messages={child.messages}
						onExpandImage={onExpandImage}
						onProceedWhileRunning={onProceedWhileRunning}
						reportedArtifacts={child.reportedArtifacts}
					/>
				);
			}
			if (child.type !== "message") {
				return null;
			}
			const firstReasoningMessage = child.reasoningMessages[0];
			const lastReasoningMessage = child.reasoningMessages.at(-1);
			const reasoningContent = child.reasoningMessages
				.map((reasoningMessage) => reasoningMessage.reasoning?.trim())
				.filter((content): content is string => Boolean(content))
				.join("\n\n");
			const reasoningRedacted = child.reasoningMessages.some(
				(reasoningMessage) => reasoningMessage.reasoningRedacted === true,
			);
			const thoughtDurationMilliseconds =
				firstReasoningMessage && lastReasoningMessage
					? getThoughtDurationMilliseconds(
							previousTimestampByMessage?.get(firstReasoningMessage),
							lastReasoningMessage.createdAt,
						)
					: undefined;

			return (
				<MessageBubble
					agentRole={child.agentRole}
					completionDurationMilliseconds={turnCompletionDurationByMessageId?.get(
						child.message.id,
					)}
					isLastAssistantMessage={false}
					isReasoningStreaming={false}
					isStreaming={false}
					key={child.message.id}
					message={child.message}
					onCopyMessage={onCopyMessage}
					onExpandImage={onExpandImage}
					reasoningContent={reasoningContent}
					reasoningRedacted={reasoningRedacted}
					thoughtDurationMilliseconds={thoughtDurationMilliseconds}
					wasCopied={copiedChildMessageId === child.message.id}
				/>
			);
		};

		return (
			<WorkActivity
				onOpenChange={(open) => {
					if (open) {
						setHasOpened(true);
					}
				}}
			>
				<WorkActivityTrigger
					durationMilliseconds={durationMilliseconds}
					toolCallCount={toolCallCount}
				/>
				<WorkActivityContent>
					{children ??
						(hasOpened && items ? items.map(renderWorkingItem) : null)}
				</WorkActivityContent>
			</WorkActivity>
		);
	},
	(prev, next) =>
		prev.durationMilliseconds === next.durationMilliseconds &&
		prev.toolCallCount === next.toolCallCount &&
		prev.items === next.items &&
		prev.children === next.children &&
		prev.copiedChildMessageId === next.copiedChildMessageId &&
		prev.onCopyMessage === next.onCopyMessage &&
		prev.onExpandImage === next.onExpandImage &&
		prev.onProceedWhileRunning === next.onProceedWhileRunning,
);
