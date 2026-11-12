import { SqliteSessionStore } from "@cline/core";
import { resolveDbDataDir } from "@cline/shared/storage";

let cachedStore: SqliteSessionStore | null = null;
let cachedDataDir: string | null = null;
let cachedStoreCtor: unknown = null;

export function getSharedSessionStore(): SqliteSessionStore {
	// Test suites that mock `SqliteSessionStore` with a lightweight class
	// without `close` receive a fresh instance per call.
	if (typeof SqliteSessionStore.prototype?.close !== "function") {
		return new SqliteSessionStore();
	}
	const currentDataDir = resolveDbDataDir();
	if (
		cachedStore &&
		cachedStoreCtor === SqliteSessionStore &&
		cachedDataDir === currentDataDir
	) {
		return cachedStore;
	}
	cachedStore?.close?.();
	cachedStore = new SqliteSessionStore({ sessionsDir: currentDataDir });
	cachedDataDir = currentDataDir;
	cachedStoreCtor = SqliteSessionStore;
	return cachedStore;
}

export function closeSharedSessionStore(): void {
	cachedStore?.close?.();
	cachedStore = null;
	cachedDataDir = null;
	cachedStoreCtor = null;
}
