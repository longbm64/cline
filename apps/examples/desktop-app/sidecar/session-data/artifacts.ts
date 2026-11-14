import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { JsonRecord } from "../types";
import { parseF64Value, parseU64Value } from "./common";

type HookLogCacheEntry = {
	size: number;
	mtimeMs: number;
	ctimeMs: number;
	ino: number;
	bySession: Map<string, JsonRecord[]>;
};

const MAX_HOOK_LOG_CACHE_ENTRIES = 8;
const hookLogCache = new Map<string, HookLogCacheEntry>();
const hookLogInFlight = new Map<string, Promise<Map<string, JsonRecord[]>>>();

function resolveGlobalHookLogPath(): string {
	const envPath = process.env.CLINE_HOOKS_LOG_PATH?.trim();
	if (envPath) return envPath;
	const dataDir =
		process.env.CLINE_DATA_DIR?.trim() ||
		join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".cline", "data");
	return join(dataDir, "logs", "hooks.jsonl");
}

function formatHookEntry(value: JsonRecord, hookName: string): JsonRecord {
	const usage =
		(value.turn &&
		typeof value.turn === "object" &&
		(value.turn as JsonRecord).usage &&
		typeof (value.turn as JsonRecord).usage === "object"
			? ((value.turn as JsonRecord).usage as JsonRecord)
			: undefined) ||
		(value.usage && typeof value.usage === "object"
			? (value.usage as JsonRecord)
			: undefined) ||
		(value.turn_usage && typeof value.turn_usage === "object"
			? (value.turn_usage as JsonRecord)
			: undefined);
	return {
		ts: typeof value.ts === "string" ? value.ts : "",
		hookName,
		agentId: value.agent_id,
		taskId: value.taskId ?? value.conversation_id,
		parentAgentId: value.parent_agent_id,
		iteration: parseU64Value(value.iteration),
		toolName:
			(value.tool_call &&
				typeof value.tool_call === "object" &&
				(value.tool_call as JsonRecord).name) ||
			(value.tool_result &&
				typeof value.tool_result === "object" &&
				(value.tool_result as JsonRecord).name),
		toolInput:
			(value.tool_call &&
				typeof value.tool_call === "object" &&
				(value.tool_call as JsonRecord).input) ||
			(value.tool_result &&
				typeof value.tool_result === "object" &&
				(value.tool_result as JsonRecord).input),
		toolOutput:
			value.tool_result && typeof value.tool_result === "object"
				? (value.tool_result as JsonRecord).output
				: undefined,
		toolError:
			value.tool_result && typeof value.tool_result === "object"
				? (value.tool_result as JsonRecord).error
				: undefined,
		inputTokens:
			parseU64Value(usage?.inputTokens) ??
			parseU64Value(usage?.input_tokens) ??
			parseU64Value(usage?.prompt_tokens),
		outputTokens:
			parseU64Value(usage?.outputTokens) ??
			parseU64Value(usage?.output_tokens) ??
			parseU64Value(usage?.completion_tokens),
		totalCost:
			parseF64Value(usage?.totalCost) ??
			parseF64Value(usage?.total_cost) ??
			parseF64Value(usage?.cost),
	};
}

function indexHookLogContent(raw: string): Map<string, JsonRecord[]> {
	const bySession = new Map<string, JsonRecord[]>();
	let lineStart = 0;
	while (lineStart <= raw.length) {
		const nlIndex = raw.indexOf("\n", lineStart);
		const lineEnd = nlIndex === -1 ? raw.length : nlIndex;
		const line = raw.slice(lineStart, lineEnd).replace(/\r$/, "");
		lineStart = nlIndex === -1 ? raw.length + 1 : nlIndex + 1;
		if (!line.trim()) {
			continue;
		}
		try {
			const value = JSON.parse(line) as JsonRecord;
			const hookName =
				(typeof value.hookName === "string" && value.hookName) ||
				(typeof value.hook_event_name === "string" && value.hook_event_name) ||
				(typeof value.event === "string" && value.event) ||
				"";
			if (!hookName) {
				continue;
			}
			const rootSessionId =
				value.sessionContext &&
				typeof value.sessionContext === "object" &&
				typeof (value.sessionContext as JsonRecord).rootSessionId === "string"
					? ((value.sessionContext as JsonRecord).rootSessionId as string)
					: undefined;
			const eventSessionId =
				typeof value.sessionId === "string" ? value.sessionId : undefined;
			const taskSessionId =
				typeof value.taskId === "string" ? value.taskId : undefined;
			const targets = new Set<string>();
			if (rootSessionId) targets.add(rootSessionId);
			if (eventSessionId) targets.add(eventSessionId);
			if (taskSessionId) targets.add(taskSessionId);
			if (targets.size === 0) {
				continue;
			}
			const entry = formatHookEntry(value, hookName);
			for (const targetSessionId of targets) {
				let bucket = bySession.get(targetSessionId);
				if (!bucket) {
					bucket = [];
					bySession.set(targetSessionId, bucket);
				}
				bucket.push(entry);
			}
		} catch {
			// Ignore malformed lines.
		}
	}
	return bySession;
}

async function getIndexedHookLog(
	path: string,
): Promise<Map<string, JsonRecord[]> | null> {
	let fileStat: Awaited<ReturnType<typeof stat>>;
	try {
		fileStat = await stat(path);
	} catch {
		hookLogCache.delete(path);
		return null;
	}
	const cached = hookLogCache.get(path);
	if (
		cached &&
		cached.size === fileStat.size &&
		cached.mtimeMs === fileStat.mtimeMs &&
		cached.ctimeMs === fileStat.ctimeMs &&
		cached.ino === fileStat.ino
	) {
		hookLogCache.delete(path);
		hookLogCache.set(path, cached);
		return cached.bySession;
	}
	const inFlightKey = `${path}:${fileStat.size}:${fileStat.mtimeMs}:${fileStat.ctimeMs}:${fileStat.ino}`;
	const existingLoad = hookLogInFlight.get(inFlightKey);
	if (existingLoad) {
		return await existingLoad;
	}
	const loadPromise = (async () => {
		const raw = await readFile(path, "utf8");
		const bySession = indexHookLogContent(raw);
		hookLogCache.delete(path);
		hookLogCache.set(path, {
			size: fileStat.size,
			mtimeMs: fileStat.mtimeMs,
			ctimeMs: fileStat.ctimeMs,
			ino: fileStat.ino,
			bySession,
		});
		if (hookLogCache.size > MAX_HOOK_LOG_CACHE_ENTRIES) {
			const oldest = hookLogCache.keys().next().value;
			if (oldest !== undefined) {
				hookLogCache.delete(oldest);
			}
		}
		return bySession;
	})().finally(() => {
		if (hookLogInFlight.get(inFlightKey) === loadPromise) {
			hookLogInFlight.delete(inFlightKey);
		}
	});
	hookLogInFlight.set(inFlightKey, loadPromise);
	return await loadPromise;
}

export async function readSessionHooks(
	sessionId: string,
	limit = 300,
): Promise<unknown[]> {
	const path = resolveGlobalHookLogPath();
	const bySession = await getIndexedHookLog(path);
	if (!bySession) {
		return [];
	}
	const events = bySession.get(sessionId);
	if (!events || events.length === 0) {
		return [];
	}
	const max = Math.max(1, limit);
	return events.slice(-max);
}
