"use client";

import {
	AlertCircle,
	ArrowUpRight,
	Bot,
	Check,
	Clock3,
	CornerUpLeft,
	Loader2,
	Maximize2,
	Minimize2,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
	AskQuestionRequestItem,
	ChatTransportState,
	ToolApprovalRequestItem,
} from "@/hooks/chat-session/types";
import type { SubagentColumnData } from "@/hooks/use-subagent-streams";
import {
	describeAgentActivity,
	type SessionAgentActivity,
	type SessionAgentRunState,
} from "@/lib/session-agents";
import { cn } from "@/lib/utils";
import { ChatMessages } from "./chat-messages";

const COLUMN_STATE_ICON: Record<SessionAgentRunState, typeof Check> = {
	running: Loader2,
	completed: Check,
	failed: AlertCircle,
	cancelled: Clock3,
	unresolved: Clock3,
};

const COLUMN_STATE_CLASS: Record<SessionAgentRunState, string> = {
	running: "text-foreground",
	completed: "text-chart-2",
	failed: "text-destructive",
	cancelled: "text-muted-foreground",
	unresolved: "text-muted-foreground",
};

const NO_APPROVALS: ToolApprovalRequestItem[] = [];
const NO_QUESTIONS: AskQuestionRequestItem[] = [];

function summarizePromptLine(prompt: string | undefined): string {
	if (!prompt) return "Delegated task";
	const collapsed = prompt.replace(/\s+/g, " ").trim();
	return collapsed || "Delegated task";
}

type SubagentColumnsViewProps = {
	columns: SubagentColumnData[];
	activity: SessionAgentActivity;
	chatTransportState?: ChatTransportState;
	pendingToolApprovals: ToolApprovalRequestItem[];
	pendingAskQuestions: AskQuestionRequestItem[];
	onApproveToolApproval: (requestId: string) => void | Promise<void>;
	onRejectToolApproval: (requestId: string) => void | Promise<void>;
	onAnswerAskQuestion: (
		requestId: string,
		answer: string,
	) => void | Promise<void>;
	onProceedWhileRunning?: (
		sessionId: string,
		toolCallId?: string,
	) => void | Promise<void>;
	onBackToMainChat: () => void;
	onOpenAgentSession?: (agentSessionId: string) => void | Promise<void>;
};

function SubagentColumnsViewImpl({
	columns,
	activity,
	chatTransportState,
	pendingToolApprovals,
	pendingAskQuestions,
	onApproveToolApproval,
	onRejectToolApproval,
	onAnswerAskQuestion,
	onProceedWhileRunning,
	onBackToMainChat,
	onOpenAgentSession,
}: SubagentColumnsViewProps) {
	const [zoomedKey, setZoomedKey] = useState<string | null>(null);

	const activeZoomedColumn = useMemo(
		() =>
			zoomedKey ? (columns.find((col) => col.key === zoomedKey) ?? null) : null,
		[columns, zoomedKey],
	);

	const visibleColumns = activeZoomedColumn ? [activeZoomedColumn] : columns;
	const activitySummary = describeAgentActivity(activity);
	const isCoordinating = activity.running > 0;

	return (
		<div
			className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background"
			data-testid="subagent-columns-view"
		>
			{/* Compact Main Agent coordinator bar */}
			<div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-card/60 px-3 py-1.5">
				<div className="flex min-w-0 items-center gap-2 text-xs">
					<Bot
						aria-hidden="true"
						className="size-3.5 shrink-0 text-muted-foreground"
					/>
					<span className="shrink-0 font-medium text-foreground">
						Main Agent
					</span>
					<span className="text-muted-foreground">·</span>
					<span
						className="truncate text-muted-foreground"
						title={activitySummary}
					>
						{isCoordinating
							? `Coordinating ${activitySummary}`
							: activitySummary}
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{activeZoomedColumn ? (
						<Button
							aria-label="Restore all columns"
							className="h-6 gap-1 px-2 text-xs"
							onClick={() => setZoomedKey(null)}
							size="sm"
							type="button"
							variant="ghost"
						>
							<Minimize2 aria-hidden="true" className="size-3" />
							<span>All columns ({columns.length})</span>
						</Button>
					) : null}
					<Button
						aria-label="Switch back to main agent chat"
						className="h-6 gap-1 px-2 text-xs"
						id="back-to-main-chat"
						onClick={onBackToMainChat}
						size="sm"
						title="Switch to main agent chat"
						type="button"
						variant="toolbar"
					>
						<CornerUpLeft aria-hidden="true" className="size-3" />
						<span>Main Chat</span>
					</Button>
				</div>
			</div>

			{/* Parallel Subagent Columns */}
			{columns.length === 0 ? (
				<div className="flex flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
					<Loader2 aria-hidden="true" className="mr-2 size-3.5 animate-spin" />
					Starting parallel subagents...
				</div>
			) : (
				<div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-2">
					{visibleColumns.map((col) => {
						const originalIndex = columns.findIndex((c) => c.key === col.key);
						const indexLabel = `Sub ${originalIndex >= 0 ? originalIndex + 1 : 1}`;
						const isZoomed = activeZoomedColumn?.key === col.key;
						return (
							<SubagentColumnPane
								chatTransportState={chatTransportState}
								column={col}
								indexLabel={indexLabel}
								isZoomed={isZoomed}
								key={col.key}
								onAnswerAskQuestion={onAnswerAskQuestion}
								onApproveToolApproval={onApproveToolApproval}
								onOpenAgentSession={onOpenAgentSession}
								onProceedWhileRunning={onProceedWhileRunning}
								onRejectToolApproval={onRejectToolApproval}
								onToggleZoom={() =>
									setZoomedKey((prev) => (prev === col.key ? null : col.key))
								}
								pendingAskQuestions={pendingAskQuestions}
								pendingToolApprovals={pendingToolApprovals}
								showZoomButton={columns.length > 1}
							/>
						);
					})}
				</div>
			)}
		</div>
	);
}

export const SubagentColumnsView = memo(SubagentColumnsViewImpl);

const SubagentColumnPane = memo(function SubagentColumnPane({
	column,
	indexLabel,
	isZoomed,
	showZoomButton,
	chatTransportState,
	pendingToolApprovals,
	pendingAskQuestions,
	onApproveToolApproval,
	onRejectToolApproval,
	onAnswerAskQuestion,
	onProceedWhileRunning,
	onToggleZoom,
	onOpenAgentSession,
}: {
	column: SubagentColumnData;
	indexLabel: string;
	isZoomed: boolean;
	showZoomButton: boolean;
	chatTransportState?: ChatTransportState;
	pendingToolApprovals: ToolApprovalRequestItem[];
	pendingAskQuestions: AskQuestionRequestItem[];
	onApproveToolApproval: (requestId: string) => void | Promise<void>;
	onRejectToolApproval: (requestId: string) => void | Promise<void>;
	onAnswerAskQuestion: (
		requestId: string,
		answer: string,
	) => void | Promise<void>;
	onProceedWhileRunning?: (
		sessionId: string,
		toolCallId?: string,
	) => void | Promise<void>;
	onToggleZoom: () => void;
	onOpenAgentSession?: (agentSessionId: string) => void | Promise<void>;
}) {
	const StateIcon = COLUMN_STATE_ICON[column.state];
	const isRunning = column.state === "running";
	const promptTitle = summarizePromptLine(column.prompt);

	const columnApprovals = useMemo(() => {
		if (pendingToolApprovals.length === 0) return NO_APPROVALS;
		const filtered = pendingToolApprovals.filter(
			(item) => item.agentId === column.agentId,
		);
		return filtered.length > 0 ? filtered : NO_APPROVALS;
	}, [column.agentId, pendingToolApprovals]);

	const columnQuestions = useMemo(() => {
		if (pendingAskQuestions.length === 0) return NO_QUESTIONS;
		const filtered = pendingAskQuestions.filter(
			(item) => item.context?.agentId === column.agentId,
		);
		return filtered.length > 0 ? filtered : NO_QUESTIONS;
	}, [column.agentId, pendingAskQuestions]);

	return (
		<section
			aria-label={`${indexLabel}: ${promptTitle}`}
			className={cn(
				"flex h-full min-h-0 flex-1 basis-0 flex-col overflow-hidden rounded-lg border border-border/80 bg-card/30",
				isZoomed ? "min-w-0" : "min-w-[300px]",
			)}
			data-subagent-column={column.agentId}
		>
			{/* Column header */}
			<div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-card/80 px-2.5">
				<div className="flex min-w-0 items-center gap-1.5">
					<StateIcon
						aria-hidden="true"
						className={cn(
							"size-3.5 shrink-0",
							COLUMN_STATE_CLASS[column.state],
							isRunning && "animate-spin",
						)}
					/>
					<span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs font-medium text-secondary-foreground">
						{indexLabel}
					</span>
					{column.kind === "teamtask" ? (
						<span className="shrink-0 rounded border border-border/70 px-1 py-0.5 font-mono text-xs text-muted-foreground">
							{column.teamName ? `team:${column.teamName}` : "team"}
						</span>
					) : null}
					<span
						className="min-w-0 truncate text-xs font-medium text-foreground"
						title={promptTitle}
					>
						{promptTitle}
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-0.5">
					{column.sessionId && onOpenAgentSession ? (
						<Button
							aria-label={`Open ${indexLabel} session`}
							onClick={() =>
								void onOpenAgentSession(column.sessionId as string)
							}
							size="icon-xs"
							title="Open full agent session"
							type="button"
							variant="ghost"
						>
							<ArrowUpRight aria-hidden="true" className="size-3.5" />
						</Button>
					) : null}
					{showZoomButton ? (
						<Button
							aria-label={
								isZoomed ? `Minimize ${indexLabel}` : `Expand ${indexLabel}`
							}
							onClick={onToggleZoom}
							size="icon-xs"
							title={isZoomed ? "Restore all columns" : "Expand column"}
							type="button"
							variant="ghost"
						>
							{isZoomed ? (
								<Minimize2 aria-hidden="true" className="size-3.5" />
							) : (
								<Maximize2 aria-hidden="true" className="size-3.5" />
							)}
						</Button>
					) : null}
				</div>
			</div>

			{/* Live / Persisted column transcript */}
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
				<ChatMessages
					chatTransportState={chatTransportState}
					compact={!isZoomed}
					error={column.error}
					messages={column.messages}
					onAnswerAskQuestion={onAnswerAskQuestion}
					onApproveToolApproval={onApproveToolApproval}
					onProceedWhileRunning={onProceedWhileRunning}
					onRejectToolApproval={onRejectToolApproval}
					pendingAskQuestions={columnQuestions}
					pendingToolApprovals={columnApprovals}
					sessionId={column.sessionId ?? column.key}
					status={column.chatStatus}
					streamingMessageId={column.streamingMessageId}
					streamingToolLabel={column.streamingToolLabel}
				/>
			</div>
		</section>
	);
});
