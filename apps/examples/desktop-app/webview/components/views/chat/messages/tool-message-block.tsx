"use client";

import { AgentCommandOutput, GeneratedMediaContent } from "@cline/ui";
import {
	formatWorkDuration,
	ToolActivity,
	ToolActivityCode,
	ToolActivityContent,
	ToolActivityDetails,
	ToolActivityTrigger,
} from "@cline/ui/components/agent-chat";
import { ToolFileDiff } from "@cline/ui/components/agent-chat/tool-diff";
import type { ToolLabelPart } from "@cline/ui/components/agent-chat/tool-summary";
import Ansi from "ansi-to-react";
import { AlertCircle, Loader2 } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type ChatMessage,
	type ChatMessageImage,
	ChatMessageImageSchema,
} from "@/lib/chat-schema";
import { appendCappedCommandOutput } from "@/lib/command-output";
import { cn } from "@/lib/utils";
import { MemoizedMarkdown } from "../../../ui/markdown";
import { IS_DEBUG, STREAMING_TITLE_CLASS } from "./constants";
import { MessageImageCarousel } from "./image-carousel";
import { PublishedArtifacts } from "./published-artifacts";
import { getToolNameIcon } from "./tool-icons";
import {
	buildToolPresentation,
	extractRunCommandOutput,
	extractSubmitSummaryText,
	formatToolValue,
	getPublishedArtifacts,
	isUxVerificationMessage,
	type ReportedArtifacts,
} from "./tool-summaries";
import { UxVerificationMessage } from "./ux-verification-message";

type ProceedWhileRunningHandler = (
	sessionId: string,
	toolCallId?: string,
) => void | Promise<void>;

function ToolLabel({
	parts,
	isRunning,
	badge,
}: {
	parts: ToolLabelPart[];
	isRunning: boolean;
	badge?: string;
}) {
	return (
		<>
			<span className={cn(isRunning && STREAMING_TITLE_CLASS)}>
				{parts.map((part, index) =>
					part.code ? (
						<span className="font-mono" key={`${index}_${part.text}`}>
							{part.text}
						</span>
					) : (
						<span key={`${index}_${part.text}`}>{part.text}</span>
					),
				)}
			</span>
			{badge ? (
				<span className="ml-1.5 text-xs font-normal text-muted-foreground/70">
					{badge}
				</span>
			) : null}
		</>
	);
}

const ToolCallRow = memo(function ToolCallRow({
	message,
	reportedArtifactIds,
	isRunActive,
	onExpandImage,
	onProceedWhileRunning,
}: {
	message: ChatMessage;
	reportedArtifactIds?: ReadonlySet<string>;
	isRunActive: boolean;
	onExpandImage?: (image: ChatMessageImage) => void;
	onProceedWhileRunning?: ProceedWhileRunningHandler;
}) {
	const { payload, toolName, inProgress, summary } =
		buildToolPresentation(message);
	// A missing result can outlive its run. Only gate the running display;
	// keep the message intact so a later result can still replace it.
	const isRunning = inProgress && isRunActive;
	const isCommand = summary.kind === "command";
	const isEdit = summary.kind === "edit";
	// submit_and_exit carries the run's final answer (scheduled tasks end with
	// it), so surface it expanded and rendered as markdown rather than leaving
	// it collapsed behind a code block.
	const isSubmit = summary.toolName === "submit_and_exit";
	const submitText = isSubmit
		? extractSubmitSummaryText(payload) || summary.outputText || ""
		: "";
	// The generic fallback label ("Submit and exit") describes the tool, not
	// the moment; name the milestone the row represents instead.
	const labelParts = isSubmit
		? [
				{
					text: inProgress
						? "Completing scheduled task"
						: payload?.isError
							? "Scheduled task failed"
							: "Scheduled task completed",
				},
			]
		: summary.labelParts;
	const commandOutputSource = isCommand
		? message.meta?.toolOutput ||
			(payload?.isError
				? ""
				: extractRunCommandOutput(payload?.result) || summary.outputText || "")
		: "";
	const commandOutput = commandOutputSource
		? appendCappedCommandOutput("", commandOutputSource).output
		: "";
	const toolSessionId = message.sessionId;
	const toolCallId = message.meta?.toolCallId;
	const canProceed = Boolean(
		isRunning &&
			isCommand &&
			message.meta?.toolDetachable === true &&
			toolSessionId &&
			onProceedWhileRunning,
	);
	const fileDiffs = summary.items.flatMap((item, index) => {
		if (item.type !== "file") return [];
		const hunks =
			item.hunks ??
			(item.newText !== undefined
				? [{ oldText: item.oldText, newText: item.newText }]
				: null);
		if (hunks) {
			return hunks.map((hunk, hunkIndex) => ({
				key: `${message.id}_diff_${index}_${hunkIndex}`,
				kind: "rich" as const,
				item,
				hunk,
			}));
		}
		return item.diff
			? [
					{
						key: `${message.id}_diff_${index}`,
						kind: "text" as const,
						item,
						hunk: null,
					},
				]
			: [];
	});
	const hasFileDiffs = fileDiffs.length > 0;
	const outputImages = summary.outputMedia.flatMap((media, index) => {
		if (media.modality !== "image") return [];
		const image = ChatMessageImageSchema.safeParse({
			id: `${message.id}_tool_image_${index}`,
			mediaType: media.mediaType,
			data: media.data,
		});
		return image.success ? [image.data] : [];
	});
	const otherOutputMedia = summary.outputMedia.filter(
		(media) => media.modality !== "image",
	);
	const publishedFiles = getPublishedArtifacts(message);
	const hasError = Boolean(payload?.isError) || Boolean(summary.errorText);
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	useEffect(() => {
		if (!isRunning) return;
		const startedAt = Date.now();
		const interval = window.setInterval(() => {
			setElapsedSeconds(
				Math.max(1, Math.floor((Date.now() - startedAt) / 1000)),
			);
		}, 1000);
		return () => window.clearInterval(interval);
	}, [isRunning]);
	const shouldAutoOpen =
		Boolean(publishedFiles) ||
		hasFileDiffs ||
		Boolean(submitText) ||
		summary.outputMedia.length > 0 ||
		(inProgress &&
			(Boolean(commandOutput) || (isCommand && elapsedSeconds >= 1)));
	const [open, setOpen] = useState(shouldAutoOpen);
	const [userToggled, setUserToggled] = useState(false);
	const [isProceeding, setIsProceeding] = useState(false);
	const [proceedError, setProceedError] = useState<string | null>(null);
	useEffect(() => {
		if (userToggled) return;
		if (shouldAutoOpen) {
			setOpen(true);
		} else if (!inProgress && isCommand && !commandOutput && !hasError) {
			setOpen(false);
		}
	}, [
		shouldAutoOpen,
		userToggled,
		inProgress,
		isCommand,
		commandOutput,
		hasError,
	]);
	const handleOpenChange = useCallback((nextOpen: boolean) => {
		setUserToggled(true);
		setOpen(nextOpen);
	}, []);
	const handleProceedWhileRunning = useCallback(async () => {
		if (!onProceedWhileRunning || !toolSessionId || isProceeding) return;
		setIsProceeding(true);
		setProceedError(null);
		try {
			await Promise.resolve(onProceedWhileRunning(toolSessionId, toolCallId));
		} catch (error) {
			setProceedError(
				error instanceof Error
					? error.message
					: "Could not detach the running command.",
			);
		} finally {
			setIsProceeding(false);
		}
	}, [isProceeding, onProceedWhileRunning, toolCallId, toolSessionId]);

	const Icon = getToolNameIcon(toolName);
	const readLineCountsByDetail =
		summary.kind === "read"
			? summary.items.map((item) =>
					item.type === "file" ? item.lineCount : undefined,
				)
			: [];
	const totalReadLines = readLineCountsByDetail.reduce<number | undefined>(
		(acc, count) => (typeof count === "number" ? (acc ?? 0) + count : acc),
		undefined,
	);
	const readLinesBadge =
		summary.kind === "read" && !isRunning && typeof totalReadLines === "number"
			? `(${totalReadLines} ${totalReadLines === 1 ? "line" : "lines"})`
			: undefined;
	const durationBadge =
		elapsedSeconds >= 1 && (isRunning || isCommand)
			? `(${formatWorkDuration(elapsedSeconds * 1000)})`
			: undefined;
	const editRunningBadge =
		isRunning && isEdit
			? elapsedSeconds >= 1
				? `Writing... (${formatWorkDuration(elapsedSeconds * 1000)})`
				: "Writing..."
			: undefined;
	const triggerBadge = readLinesBadge ?? editRunningBadge ?? durationBadge;
	const details = summary.details.map((detail, index) => {
		const lineCount = readLineCountsByDetail[index];
		return {
			detail:
				typeof lineCount === "number"
					? `${detail} (${lineCount} ${lineCount === 1 ? "line" : "lines"})`
					: detail,
			key: `${message.id}_${index}`,
		};
	});
	const inputPreview =
		IS_DEBUG && payload ? formatToolValue(payload.input) : "";
	const hasExpandedSections =
		Boolean(publishedFiles) ||
		details.length > 0 ||
		fileDiffs.length > 0 ||
		Boolean(submitText) ||
		Boolean(isCommand ? commandOutput || isRunning : summary.outputText) ||
		Boolean(isEdit && isRunning) ||
		summary.outputMedia.length > 0 ||
		Boolean(summary.errorText) ||
		Boolean(inputPreview) ||
		canProceed;

	return (
		<ToolActivity
			className="my-0"
			expandable={hasExpandedSections}
			onOpenChange={handleOpenChange}
			open={open}
		>
			<ToolActivityTrigger
				additions={summary.diff?.additions || undefined}
				deletions={summary.diff?.deletions || undefined}
				icon={
					hasError ? (
						<AlertCircle className="size-4 text-destructive/80" />
					) : (
						<Icon className="size-4" />
					)
				}
				label={
					<ToolLabel
						badge={triggerBadge}
						isRunning={isRunning}
						parts={labelParts}
					/>
				}
				showDisclosureIcon={hasExpandedSections}
				status={hasError ? "error" : isRunning ? "running" : "success"}
			/>
			<ToolActivityContent presentation="rail">
				{details.length > 0 ? (
					<ToolActivityDetails
						className={cn(
							"whitespace-pre-wrap",
							isCommand && "font-mono text-xs",
						)}
					>
						{details.map(({ detail, key }) => (
							<div key={key}>{isCommand ? `$ ${detail}` : detail}</div>
						))}
					</ToolActivityDetails>
				) : null}
				{fileDiffs.map((entry) =>
					entry.kind === "rich" && entry.hunk ? (
						<ToolFileDiff
							className="mt-1"
							fragment={entry.item.fragment}
							key={entry.key}
							newText={entry.hunk.newText}
							oldText={entry.hunk.oldText}
							path={entry.item.path}
						/>
					) : (
						<ToolActivityCode
							className="mt-1 overflow-x-auto text-xs"
							key={entry.key}
						>
							{entry.item.diff}
						</ToolActivityCode>
					),
				)}
				{publishedFiles && message.sessionId ? (
					<PublishedArtifacts
						files={publishedFiles}
						reportedArtifactIds={reportedArtifactIds}
						sessionId={message.sessionId}
					/>
				) : commandOutput || (isCommand && isRunning) ? (
					<AgentCommandOutput isRunning={isRunning} output={commandOutput}>
						{commandOutput ? (
							<Ansi>{commandOutput}</Ansi>
						) : (
							<span className="text-zinc-400">
								Waiting for command output...
							</span>
						)}
					</AgentCommandOutput>
				) : submitText ? (
					// The summary is the run's final answer: full foreground color,
					// not the panel's muted tool-detail gray.
					<div className="mt-1 min-w-0 max-w-full wrap-break-word text-foreground">
						<MemoizedMarkdown content={submitText} />
					</div>
				) : summary.outputText ? (
					<ToolActivityCode className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
						{summary.outputText}
					</ToolActivityCode>
				) : null}
				{outputImages.length > 0 ? (
					<div className="mt-2">
						<MessageImageCarousel
							images={outputImages}
							onExpandImage={onExpandImage}
						/>
					</div>
				) : null}
				{otherOutputMedia.length > 0 ? (
					<div className="mt-2 flex max-w-2xl flex-col gap-2">
						{otherOutputMedia.map((media, index) => (
							<GeneratedMediaContent
								classNames={{
									audio: "w-full",
									video: "max-h-96 max-w-full rounded-lg",
									file: "text-sm underline",
									unavailable:
										"rounded-lg border border-border bg-muted p-3 text-sm",
								}}
								key={`${message.id}_tool_media_${index}`}
								media={{
									id: `${message.id}_tool_media_${index}`,
									modality: media.modality,
									mediaType: media.mediaType,
									name: media.name,
									source: { type: "base64", data: media.data },
								}}
							/>
						))}
					</div>
				) : null}
				{inputPreview ? (
					<div className="space-y-1">
						<div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
							Input
						</div>
						<ToolActivityCode className="text-sm">
							{inputPreview}
						</ToolActivityCode>
					</div>
				) : null}
				{summary.errorText && summary.errorText !== commandOutput ? (
					<div className="mt-1 break-words text-destructive">
						{summary.errorText}
					</div>
				) : null}
				{isRunning && isEdit ? (
					<div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
						<Loader2 className="size-3.5 animate-spin" />
						<span>
							Writing
							{elapsedSeconds >= 1
								? ` (${formatWorkDuration(elapsedSeconds * 1000)})`
								: "..."}
						</span>
					</div>
				) : null}
				{isRunning && isCommand ? (
					<div className="mt-2 flex flex-wrap items-center justify-between gap-2">
						<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<Loader2 className="size-3.5 animate-spin" />
							<span>
								{commandOutput
									? "Command is running"
									: "Waiting for command output"}
								{elapsedSeconds >= 1
									? ` (${formatWorkDuration(elapsedSeconds * 1000)})`
									: "..."}
							</span>
						</div>
						{canProceed ? (
							<Button
								disabled={isProceeding}
								onClick={() => void handleProceedWhileRunning()}
								size="sm"
								type="button"
								variant="outline"
							>
								{isProceeding ? (
									<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
								) : null}
								Proceed while running
							</Button>
						) : null}
					</div>
				) : null}
				{canProceed && proceedError ? (
					<div className="mt-1 text-xs text-destructive">{proceedError}</div>
				) : null}
			</ToolActivityContent>
		</ToolActivity>
	);
});

function sameReportedArtifacts(a?: ReportedArtifacts, b?: ReportedArtifacts) {
	if (a === b) return true;
	if (!a || !b || a.size !== b.size) return false;
	for (const [sessionId, ids] of a) {
		const other = b.get(sessionId);
		if (!other || ids.size !== other.size) return false;
		for (const id of ids) {
			if (!other.has(id)) return false;
		}
	}
	return true;
}

export const ToolMessageBlock = memo(
	function ToolMessageBlock({
		messages,
		reportedArtifacts,
		isRunActive,
		onExpandImage,
		onProceedWhileRunning,
	}: {
		messages: ChatMessage[];
		reportedArtifacts?: ReportedArtifacts;
		isRunActive: boolean;
		onExpandImage?: (image: ChatMessageImage) => void;
		onProceedWhileRunning?: ProceedWhileRunningHandler;
	}) {
		if (messages.length === 0) return null;
		return (
			<div className="flex flex-col gap-1">
				{messages.map((message) =>
					isUxVerificationMessage(message) ? (
						<UxVerificationMessage key={message.id} message={message} />
					) : (
						<ToolCallRow
							isRunActive={isRunActive}
							key={message.id}
							message={message}
							reportedArtifactIds={
								message.sessionId
									? reportedArtifacts?.get(message.sessionId)
									: undefined
							}
							onExpandImage={onExpandImage}
							onProceedWhileRunning={onProceedWhileRunning}
						/>
					),
				)}
			</div>
		);
	},
	(prev, next) =>
		prev.isRunActive === next.isRunActive &&
		sameReportedArtifacts(prev.reportedArtifacts, next.reportedArtifacts) &&
		prev.messages.length === next.messages.length &&
		prev.messages.every((message, index) => message === next.messages[index]) &&
		prev.onExpandImage === next.onExpandImage &&
		prev.onProceedWhileRunning === next.onProceedWhileRunning,
);
