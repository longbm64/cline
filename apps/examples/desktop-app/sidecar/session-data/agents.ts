import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { MessageWithMetadata } from "@cline/shared";
import { getSharedSessionStore } from "./store";

/**
 * Child agents of a chat session: `spawn_agent` subagent runs and team-task
 * teammate runs. Both are persisted as sessions parented to the root session
 * (see the SDK's team-child-session-manager), which is the only place their
 * real status lives — the tool events forwarded to the webview carry no agent
 * attribution at all.
 */
export type SessionAgentRecord = {
	sessionId: string;
	agentId: string;
	parentAgentId?: string;
	/** "subagent" for spawn_agent runs, "teamtask" for team-task runs. */
	kind: "subagent" | "teamtask";
	status: string;
	/** The task the agent was given — its first prompt. */
	prompt?: string;
	/** Most recent thing the agent did, for an at-a-glance progress line. */
	lastAction?: string;
	teamName?: string;
	provider?: string;
	model?: string;
	startedAt: string;
	endedAt?: string;
	/** Whether a transcript exists to open yet. */
	hasMessages: boolean;
};

const TEAM_TASK_MARKER = "__teamtask__";
const LAST_ACTION_LIMIT = 160;

const MAX_CHILD_MESSAGES_CACHE = 32;
const childMessagesCache = new Map<
	string,
	{
		size: number;
		mtimeMs: number;
		ctimeMs: number;
		ino: number;
		messages: MessageWithMetadata[];
	}
>();

function parseMessagesFileContent(raw: string): MessageWithMetadata[] {
	const parsed = JSON.parse(raw) as
		| { messages?: MessageWithMetadata[] }
		| MessageWithMetadata[];
	if (Array.isArray(parsed)) {
		return parsed;
	}
	return Array.isArray(parsed.messages) ? parsed.messages : [];
}

function getCachedChildMessages(
	path: string,
	fileStat: { size: number; mtimeMs: number; ctimeMs: number; ino: number },
): MessageWithMetadata[] | null {
	const cached = childMessagesCache.get(path);
	if (
		!cached ||
		cached.size !== fileStat.size ||
		cached.mtimeMs !== fileStat.mtimeMs ||
		cached.ctimeMs !== fileStat.ctimeMs ||
		cached.ino !== fileStat.ino
	) {
		return null;
	}
	childMessagesCache.delete(path);
	childMessagesCache.set(path, cached);
	return cached.messages;
}

function setCachedChildMessages(
	path: string,
	fileStat: { size: number; mtimeMs: number; ctimeMs: number; ino: number },
	messages: MessageWithMetadata[],
): void {
	childMessagesCache.delete(path);
	childMessagesCache.set(path, {
		size: fileStat.size,
		mtimeMs: fileStat.mtimeMs,
		ctimeMs: fileStat.ctimeMs,
		ino: fileStat.ino,
		messages,
	});
	if (childMessagesCache.size > MAX_CHILD_MESSAGES_CACHE) {
		const oldest = childMessagesCache.keys().next().value;
		if (oldest !== undefined) {
			childMessagesCache.delete(oldest);
		}
	}
}

function readMessagesFile(path: string): MessageWithMetadata[] | null {
	if (!path || !existsSync(path)) {
		if (path) {
			childMessagesCache.delete(path);
		}
		return null;
	}
	try {
		const fileStat = statSync(path);
		const cached = getCachedChildMessages(path, fileStat);
		if (cached !== null) {
			return cached;
		}
		const messages = parseMessagesFileContent(readFileSync(path, "utf8"));
		setCachedChildMessages(path, fileStat, messages);
		return messages;
	} catch {
		return null;
	}
}

async function readMessagesFileAsync(
	path: string,
): Promise<MessageWithMetadata[] | null> {
	if (!path) {
		return null;
	}
	try {
		const fileStat = await stat(path);
		const cached = getCachedChildMessages(path, fileStat);
		if (cached !== null) {
			return cached;
		}
		const messages = parseMessagesFileContent(await readFile(path, "utf8"));
		setCachedChildMessages(path, fileStat, messages);
		return messages;
	} catch {
		childMessagesCache.delete(path);
		return null;
	}
}

/**
 * A child row records where its transcript was written. Deriving the path here
 * instead would mean duplicating the SDK's artifact layout, which nests child
 * transcripts under the root session directory keyed by agent id.
 */
function resolveChildMessagesPath(record: {
	messagesPath?: string;
}): string | undefined {
	return record.messagesPath?.trim() || undefined;
}

function resolveChildMessagesRecordPath(sessionId: string): string | undefined {
	const trimmed = sessionId.trim();
	if (!trimmed) {
		return undefined;
	}
	let record: { parentSessionId?: string; messagesPath?: string } | undefined;
	try {
		record = getSharedSessionStore().get(trimmed);
	} catch {
		// No session database on this host; nothing to resolve.
		return undefined;
	}
	if (!record?.parentSessionId) {
		return undefined;
	}
	return resolveChildMessagesPath(record);
}

/**
 * Transcript of a child agent session, or null when the id is not a child or
 * nothing has been written yet. Lets the ordinary session-reading path open a
 * subagent session without knowing where child artifacts live.
 */
export function readChildSessionMessages(
	sessionId: string,
): MessageWithMetadata[] | null {
	const messagesPath = resolveChildMessagesRecordPath(sessionId);
	return messagesPath ? readMessagesFile(messagesPath) : null;
}

export async function readChildSessionMessagesAsync(
	sessionId: string,
): Promise<MessageWithMetadata[] | null> {
	const messagesPath = resolveChildMessagesRecordPath(sessionId);
	return messagesPath ? await readMessagesFileAsync(messagesPath) : null;
}

function truncate(value: string, limit = LAST_ACTION_LIMIT): string {
	const collapsed = value.replace(/\s+/g, " ").trim();
	return collapsed.length > limit
		? `${collapsed.slice(0, limit)}...`
		: collapsed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

/**
 * Summarize the agent's most recent step from the tail of its transcript.
 *
 * A tool call names itself usefully ("Running read_files"), so it wins over
 * prose; assistant text is the fallback. Reasoning blocks are skipped — they
 * describe intent rather than an action taken.
 */
function deriveLastAction(messages: unknown[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = asRecord(messages[index]);
		if (!message || message.role !== "assistant") {
			continue;
		}
		const content = message.content;
		if (typeof content === "string") {
			const text = truncate(content);
			if (text) {
				return text;
			}
			continue;
		}
		if (!Array.isArray(content)) {
			continue;
		}
		for (
			let blockIndex = content.length - 1;
			blockIndex >= 0;
			blockIndex -= 1
		) {
			const block = asRecord(content[blockIndex]);
			if (!block) {
				continue;
			}
			if (block.type === "tool_use" && typeof block.name === "string") {
				return `Running ${block.name}`;
			}
			if (block.type === "text" && typeof block.text === "string") {
				const text = truncate(block.text);
				if (text) {
					return text;
				}
			}
		}
	}
	return undefined;
}

const MAX_AGENT_TRANSCRIPT_META_CACHE = 500;
const agentTranscriptMetaCache = new Map<
	string,
	{
		mtimeMs: number;
		size: number;
		lastAction?: string;
		hasMessages: boolean;
	}
>();

function readChildTranscriptSummary(messagesPath: string | undefined): {
	lastAction?: string;
	hasMessages: boolean;
} {
	if (!messagesPath) {
		return { hasMessages: false };
	}
	let stat: { mtimeMs: number; size: number };
	try {
		stat = statSync(messagesPath);
	} catch {
		agentTranscriptMetaCache.delete(messagesPath);
		return { hasMessages: false };
	}
	const cached = agentTranscriptMetaCache.get(messagesPath);
	if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
		return {
			lastAction: cached.lastAction,
			hasMessages: cached.hasMessages,
		};
	}
	const messages = readMessagesFile(messagesPath);
	const hasMessages = Boolean(messages && messages.length > 0);
	const lastAction =
		hasMessages && messages ? deriveLastAction(messages) : undefined;
	if (agentTranscriptMetaCache.size >= MAX_AGENT_TRANSCRIPT_META_CACHE) {
		const oldest = agentTranscriptMetaCache.keys().next().value;
		if (oldest !== undefined) {
			agentTranscriptMetaCache.delete(oldest);
		}
	}
	agentTranscriptMetaCache.set(messagesPath, {
		mtimeMs: stat.mtimeMs,
		size: stat.size,
		lastAction,
		hasMessages,
	});
	return { lastAction, hasMessages };
}

export function listSessionAgents(
	rootSessionId: string,
	limit = 200,
): SessionAgentRecord[] {
	const trimmedRootId = rootSessionId.trim();
	if (!trimmedRootId) {
		return [];
	}
	const store = getSharedSessionStore();
	const out: SessionAgentRecord[] = [];
	for (const record of store.listChildren(trimmedRootId, limit)) {
		const agentId = record.agentId?.trim();
		if (!agentId) {
			continue;
		}
		const messagesPath = resolveChildMessagesPath(record);
		const summary = readChildTranscriptSummary(messagesPath);
		out.push({
			sessionId: record.sessionId,
			agentId,
			parentAgentId: record.parentAgentId,
			kind: record.sessionId.includes(TEAM_TASK_MARKER)
				? "teamtask"
				: "subagent",
			status: record.status,
			prompt: record.prompt,
			lastAction: summary.lastAction,
			teamName: record.teamName,
			provider: record.provider || undefined,
			model: record.model || undefined,
			startedAt: record.startedAt,
			endedAt: record.endedAt ?? undefined,
			hasMessages: summary.hasMessages,
		});
	}
	return out;
}
