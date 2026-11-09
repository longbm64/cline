"use client";

import { ChevronRight, FileDiff } from "lucide-react";
import { useState } from "react";
import { type SessionChangeSet, sumChanges } from "@/lib/session-changes";
import { cn } from "@/lib/utils";
import { FileIcon } from "../file-icons";

const LISTED_FILES = 3;

/**
 * What the last turn changed, shown at the end of the transcript once the
 * turn finishes. Selecting it (or a file) opens the changes pane on it.
 *
 * The file list is collapsed by default so the chat stays compact; clicking
 * the header row toggles it open. The "Review" label opens the full diff
 * panel instead.
 */
export function TurnReceipt({
	changes,
	onReview,
}: {
	changes: SessionChangeSet;
	onReview: (path?: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const { additions, deletions } = sumChanges(changes.files);
	const count = changes.files.length + changes.omitted;
	const listed = changes.files.slice(0, LISTED_FILES);
	const hidden = count - listed.length;
	return (
		<div
			className="overflow-hidden rounded-lg border border-border/80 text-xs"
			data-testid="turn-receipt"
		>
			<div className="flex w-full items-center bg-muted/40 hover:bg-surface-hover">
				<button
					aria-expanded={expanded}
					aria-label={`${expanded ? "Collapse" : "Expand"} changed files: ${count} files, ${additions} additions, ${deletions} deletions`}
					className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
					onClick={() => setExpanded(!expanded)}
					type="button"
				>
					<ChevronRight
						className={cn(
							"size-3 shrink-0 text-muted-foreground transition-transform",
							expanded && "rotate-90",
						)}
					/>
					<FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
					<span className="font-medium text-foreground">
						Changed {count} file{count === 1 ? "" : "s"}
					</span>
					<span className="font-mono text-[11px]">
						<span className="text-chart-2">+{additions}</span>{" "}
						<span className="text-destructive">-{deletions}</span>
					</span>
				</button>
				<button
					aria-label="Review changes"
					className="shrink-0 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
					onClick={() => onReview()}
					type="button"
				>
					Review
				</button>
			</div>
			{expanded ? (
				<>
					{listed.map((file) => (
						<button
							className="flex h-7 w-full items-center gap-1.5 border-t border-border/50 px-3 text-left hover:bg-surface-hover"
							key={file.path}
							onClick={() => onReview(file.path)}
							title={file.path}
							type="button"
						>
							<FileIcon path={file.path} />
							<span className="shrink-0 truncate">
								{file.path.split("/").pop()}
							</span>
							<span className="min-w-0 truncate text-[10.5px] text-muted-foreground/80">
								{file.path.split("/").slice(0, -1).join("/")}
							</span>
							<span className="ml-auto shrink-0 font-mono text-[10.5px]">
								<span className="text-chart-2">+{file.additions ?? 0}</span>{" "}
								<span className="text-destructive">-{file.deletions ?? 0}</span>
							</span>
						</button>
					))}
					{hidden > 0 ? (
						<button
							className="flex h-7 w-full items-center border-t border-border/50 px-3 text-left text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
							onClick={() => onReview()}
							type="button"
						>
							{hidden} more file{hidden === 1 ? "" : "s"}
						</button>
					) : null}
				</>
			) : null}
		</div>
	);
}
