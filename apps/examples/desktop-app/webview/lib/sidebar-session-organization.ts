import { isChatWorkspacePath } from "@cline/shared/browser";
import { normalizeTitle } from "@/components/utils";
import {
	parseTimestamp,
	type SessionThread,
} from "@/hooks/use-session-history";
import { normalizeWorkspacePath } from "@/lib/workspace-paths";

// One page of sidebar rows. Large enough to fill the sidebar on a tall
// window (10 left a stub of rows over empty space); history fetches start at
// 50, so the first page never needs an extra request.
export const INITIAL_VISIBLE_THREAD_COUNT = 30;

export const SIDEBAR_SORT_STORAGE_KEY = "cline.code.sidebar-sort.v1";

export const SIDEBAR_PROJECT_TIMESTAMPS_STORAGE_KEY =
	"cline.code.sidebar-project-timestamps.v1";

export type SidebarSortMode = "time" | "project";

export function readSidebarSortModeFromWindow(): SidebarSortMode {
	if (typeof window === "undefined") {
		return "time";
	}
	return window.localStorage.getItem(SIDEBAR_SORT_STORAGE_KEY) === "project"
		? "project"
		: "time";
}

export function writeSidebarSortModeToWindow(value: SidebarSortMode): void {
	if (typeof window === "undefined") {
		return;
	}
	window.localStorage.setItem(SIDEBAR_SORT_STORAGE_KEY, value);
}

export type SidebarProjectGroup = {
	id: string;
	label: string;
	workspacePath: string;
	threads: SessionThread[];
};

export function workspaceDisplayName(path: string): string {
	if (isChatWorkspacePath(path)) return "Chat";
	const trimmed = path.trim().replace(/[\\/]+$/, "");
	if (!trimmed) return "";
	const segments = trimmed.split(/[\\/]/).filter(Boolean);
	return segments.at(-1) || trimmed;
}

function uniqueWorkspaceLabel(path: string, workspacePaths: string[]): string {
	if (!path) return "Other";
	const segments = path
		.replace(/[\\/]+$/, "")
		.split(/[\\/]/)
		.filter(Boolean);
	const allSegments = workspacePaths.map((workspacePath) =>
		workspacePath
			.replace(/[\\/]+$/, "")
			.split(/[\\/]/)
			.filter(Boolean),
	);
	for (let depth = 1; depth <= segments.length; depth += 1) {
		const candidate = segments.slice(-depth).join("/");
		const matches = allSegments.filter(
			(other) => other.slice(-depth).join("/") === candidate,
		).length;
		if (matches === 1) return candidate;
	}
	return path;
}

function readSidebarProjectTimestampsFromWindow(): Record<string, number> {
	if (typeof window === "undefined") {
		return {};
	}
	try {
		const raw = window.localStorage.getItem(
			SIDEBAR_PROJECT_TIMESTAMPS_STORAGE_KEY,
		);
		if (!raw) {
			return {};
		}
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		const result: Record<string, number> = {};
		for (const [key, value] of Object.entries(
			parsed as Record<string, unknown>,
		)) {
			if (typeof value === "number" && Number.isFinite(value)) {
				result[key] = value;
			}
		}
		return result;
	} catch {
		return {};
	}
}

function writeSidebarProjectTimestampsToWindow(
	timestamps: Record<string, number>,
): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(
			SIDEBAR_PROJECT_TIMESTAMPS_STORAGE_KEY,
			JSON.stringify(timestamps),
		);
	} catch {
		// Ignore storage quota or private mode errors.
	}
}

export function groupThreadsByProject(
	threads: SessionThread[],
): SidebarProjectGroup[] {
	const groups = new Map<
		string,
		{
			workspacePath: string;
			threads: SessionThread[];
			oldestStartedAt: number;
			projectStartedAt: number;
			insertionIndex: number;
		}
	>();
	let nextInsertionIndex = 0;
	for (const thread of threads) {
		const workspacePath = thread.workspacePath.trim();
		const projectId = normalizeWorkspacePath(workspacePath) || "__other__";
		const threadStartedAt = parseTimestamp(thread.startedAt);
		const current = groups.get(projectId);
		if (current) {
			current.threads.push(thread);
			if (
				Number.isFinite(threadStartedAt) &&
				threadStartedAt < current.oldestStartedAt
			) {
				current.oldestStartedAt = threadStartedAt;
			}
		} else {
			groups.set(projectId, {
				workspacePath,
				threads: [thread],
				oldestStartedAt: Number.isFinite(threadStartedAt)
					? threadStartedAt
					: Number.POSITIVE_INFINITY,
				projectStartedAt: Number.NEGATIVE_INFINITY,
				insertionIndex: nextInsertionIndex++,
			});
		}
	}
	const storedTimestamps = readSidebarProjectTimestampsFromWindow();
	let timestampsUpdated = false;
	for (const [projectId, group] of groups.entries()) {
		const stored = storedTimestamps[projectId];
		if (typeof stored === "number" && Number.isFinite(stored)) {
			group.projectStartedAt = stored;
		} else if (Number.isFinite(group.oldestStartedAt)) {
			group.projectStartedAt = group.oldestStartedAt;
			storedTimestamps[projectId] = group.oldestStartedAt;
			timestampsUpdated = true;
		}
	}
	if (timestampsUpdated) {
		writeSidebarProjectTimestampsToWindow(storedTimestamps);
	}
	const orderedEntries = [...groups.entries()].sort(([, left], [, right]) => {
		const leftHasTime = Number.isFinite(left.projectStartedAt);
		const rightHasTime = Number.isFinite(right.projectStartedAt);
		if (
			leftHasTime &&
			rightHasTime &&
			right.projectStartedAt !== left.projectStartedAt
		) {
			return right.projectStartedAt - left.projectStartedAt;
		}
		if (leftHasTime !== rightHasTime) {
			return rightHasTime ? 1 : -1;
		}
		return left.insertionIndex - right.insertionIndex;
	});
	const workspacePaths = orderedEntries.map(([, group]) => group.workspacePath);
	return orderedEntries.map(([id, group]) => ({
		id,
		label: isChatWorkspacePath(group.workspacePath)
			? "Chat"
			: uniqueWorkspaceLabel(group.workspacePath, workspacePaths),
		workspacePath: group.workspacePath,
		threads: group.threads,
	}));
}

export type SidebarScheduleGroup = {
	kind: "schedule";
	/** Stable key: the schedule id when known, otherwise the shared title. */
	id: string;
	label: string;
	/** Runs in the order they were given (newest first in the sidebar). */
	threads: SessionThread[];
};

export type SidebarListRow =
	| { kind: "thread"; thread: SessionThread }
	| SidebarScheduleGroup;

/**
 * Key that decides which schedule group a thread joins. Runs stamped with a
 * schedule id (or linked to one through the executions list) group by that
 * id; older runs without one group by their shared title, since a schedule's
 * sessions all start from the same prompt. Non-scheduled threads return null.
 */
export function scheduleGroupKey(thread: SessionThread): string | null {
	if (!thread.isScheduled) return null;
	const scheduleId = thread.scheduleId?.trim();
	if (scheduleId) return `schedule:${scheduleId}`;
	const title = normalizeTitle(thread.title).trim().toLowerCase();
	return title ? `title:${title}` : null;
}

/**
 * Folds every scheduled thread into one row per schedule, keeping each group
 * at the position of its first (newest) run so the list still reads in
 * recency order. Non-scheduled threads pass through as plain rows.
 */
export function groupScheduledThreads(
	threads: readonly SessionThread[],
): SidebarListRow[] {
	const rows: SidebarListRow[] = [];
	const groups = new Map<string, SidebarScheduleGroup>();
	for (const thread of threads) {
		const key = scheduleGroupKey(thread);
		if (!key) {
			rows.push({ kind: "thread", thread });
			continue;
		}
		const existing = groups.get(key);
		if (existing) {
			existing.threads.push(thread);
			if (!existing.label) existing.label = scheduleGroupLabel(thread);
			continue;
		}
		const group: SidebarScheduleGroup = {
			kind: "schedule",
			id: key,
			label: scheduleGroupLabel(thread),
			threads: [thread],
		};
		groups.set(key, group);
		rows.push(group);
	}
	return rows;
}

function scheduleGroupLabel(thread: SessionThread): string {
	return thread.scheduleName?.trim() || normalizeTitle(thread.title).trim();
}

/**
 * Label for one run inside a schedule group. Runs the runner numbered show
 * "Run N"; older runs fall back to when they started, which is the next
 * best way to tell them apart.
 */
export function scheduleRunLabel(thread: SessionThread): string {
	if (thread.scheduleRunNumber) return `Run ${thread.scheduleRunNumber}`;
	const started = parseTimestamp(thread.startedAt);
	if (Number.isFinite(started)) {
		return new Date(started).toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		});
	}
	return "Run";
}
