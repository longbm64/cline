/**
 * Durable, cursor-addressed Hub event log.
 *
 * Every event the Hub publishes is appended here with a monotonically
 * increasing global sequence before it is fanned out to live sockets. A
 * client that reconnects can resume exactly where it left off by passing
 * `sinceSequence` on `stream.subscribe`: the adapter replays pages from this
 * log, then live-tails. Nothing about delivery depends on who was watching
 * when the event happened — disconnect never implies data loss.
 *
 * The log is a projection aid, not the source of truth for conversation
 * history (session messages remain canonical on disk); it is bounded by a
 * retention sweep so it can run forever.
 */

import { join } from "node:path";
import type { HubEventEnvelope } from "@cline/shared";
import {
	loadSqliteDb,
	type SqliteDb,
	type SqliteStatement,
} from "@cline/shared/db";
import { resolveDbDataDir } from "@cline/shared/storage";

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ROWS = 200_000;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
/** Appended bytes between sweeps; the hourly timer alone can't keep up with bursts. */
const PRUNE_EVERY_APPENDED_BYTES = 16 * 1024 * 1024;
const BATCH_FLUSH_INTERVAL_MS = 50;
const BATCH_FLUSH_MAX_ROWS = 64;

export interface HubEventLogOptions {
	/** Database file. Defaults to an owner-scoped `<data>/db/hub-events-*.db`; use ":memory:" in tests. */
	dbPath?: string;
	/** Scopes the default `dbPath`; ignored when `dbPath` is given. */
	ownerId?: string;
	/** Events older than this are pruned. Defaults to 7 days. */
	retentionMs?: number;
	/** Hard cap on rows kept, oldest pruned first. Defaults to 200k. */
	maxRows?: number;
	/** Cap on the database file size, oldest rows pruned first. Defaults to 64 MiB. */
	maxTotalBytes?: number;
}

export interface HubEventLogScope {
	sessionId?: string;
}

/**
 * Default log location, scoped per hub owner context so coexisting hubs
 * (production and a dev shared hub) never interleave one log's sequences.
 */
export function resolveHubEventLogPath(ownerId?: string): string {
	const scope = ownerId?.replace(/[^a-zA-Z0-9_-]/g, "-");
	return join(
		resolveDbDataDir(),
		scope ? `hub-events-${scope}.db` : "hub-events.db",
	);
}

type PendingEventRow = {
	sequence: number;
	event: string;
	sessionId: string | null;
	envelopeJson: string;
	createdAt: number;
};

export class HubEventLogStore {
	private readonly db: SqliteDb;
	private readonly retentionMs: number;
	private readonly maxRows: number;
	private readonly maxTotalBytes: number;
	private readonly insertStmt: SqliteStatement;
	private readonly lastSequenceStmt: SqliteStatement;
	private readonly pending: PendingEventRow[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | undefined;
	private nextSequence: number;
	private appendedBytesSincePrune = 0;
	private closed = false;

	constructor(options: HubEventLogOptions = {}) {
		this.db = loadSqliteDb(
			options.dbPath ?? resolveHubEventLogPath(options.ownerId),
		);
		this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
		this.maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
		this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
		// Every streaming chunk lands here as an INSERT; WAL keeps those
		// appends from serializing against replay reads, and the busy timeout
		// matches the other SQLite stores instead of failing fast on contention.
		// NORMAL drops the fsync per appended chunk (WAL still syncs at
		// checkpoints); this replay aid survives a process crash either way.
		this.db.exec("PRAGMA journal_mode = WAL;");
		this.db.exec("PRAGMA synchronous = NORMAL;");
		this.db.exec("PRAGMA busy_timeout = 5000;");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS hub_events (
				sequence INTEGER PRIMARY KEY AUTOINCREMENT,
				event TEXT NOT NULL,
				session_id TEXT,
				envelope_json TEXT NOT NULL,
				created_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_hub_events_session
				ON hub_events(session_id, sequence);
			CREATE INDEX IF NOT EXISTS idx_hub_events_created
				ON hub_events(created_at);
		`);
		this.insertStmt = this.db.prepare(
			`INSERT INTO hub_events (sequence, event, session_id, envelope_json, created_at)
			 VALUES (?, ?, ?, ?, ?);`,
		);
		this.lastSequenceStmt = this.db.prepare(
			"SELECT MAX(sequence) AS sequence FROM hub_events;",
		);
		const maxRow = this.lastSequenceStmt.get();
		let sqliteSeq = 0;
		try {
			const seqRow = this.db
				.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'hub_events';")
				.get();
			sqliteSeq = Number(seqRow?.seq ?? 0);
		} catch {
			// sqlite_sequence is created only after the first AUTOINCREMENT insert.
		}
		this.nextSequence = Math.max(Number(maxRow?.sequence ?? 0), sqliteSeq) + 1;
	}

	/**
	 * Append a durable event and return it stamped with its global sequence.
	 * Inserts are queued briefly and committed in a single SQLite transaction
	 * to avoid one WAL transaction per streamed chunk, while reads/prune/close
	 * flush synchronously so durability and replay ordering stay exact.
	 */
	append(envelope: HubEventEnvelope): HubEventEnvelope {
		if (this.closed) {
			return envelope;
		}
		const sequence = this.nextSequence;
		this.nextSequence += 1;
		const createdAt = envelope.timestamp ?? Date.now();
		// Stored without `sequence`; stamped from the rowid on read/return.
		const envelopeJson = JSON.stringify(envelope);
		this.pending.push({
			sequence,
			event: envelope.event,
			sessionId: envelope.sessionId ?? null,
			envelopeJson,
			createdAt,
		});
		this.appendedBytesSincePrune += Buffer.byteLength(envelopeJson);
		if (
			this.pending.length >= BATCH_FLUSH_MAX_ROWS ||
			this.appendedBytesSincePrune >= PRUNE_EVERY_APPENDED_BYTES
		) {
			this.flush();
		} else if (!this.flushTimer) {
			this.flushTimer = setTimeout(() => {
				this.flushTimer = undefined;
				this.flush();
			}, BATCH_FLUSH_INTERVAL_MS);
			this.flushTimer.unref?.();
		}
		return { ...envelope, sequence };
	}

	/** Flush buffered event inserts in a single SQLite transaction. */
	flush(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		if (this.closed || this.pending.length === 0) {
			return;
		}
		const batch = this.pending.splice(0);
		if (batch.length === 1) {
			const row = batch[0]!;
			this.insertStmt.run(
				row.sequence,
				row.event,
				row.sessionId,
				row.envelopeJson,
				row.createdAt,
			);
		} else {
			this.db.exec("BEGIN IMMEDIATE;");
			try {
				for (const row of batch) {
					this.insertStmt.run(
						row.sequence,
						row.event,
						row.sessionId,
						row.envelopeJson,
						row.createdAt,
					);
				}
				this.db.exec("COMMIT;");
			} catch (error) {
				try {
					this.db.exec("ROLLBACK;");
				} catch {
					// Preserve original transaction failure.
				}
				throw error;
			}
		}
		if (this.appendedBytesSincePrune >= PRUNE_EVERY_APPENDED_BYTES) {
			this.appendedBytesSincePrune = 0;
			this.pruneInternal(Date.now());
		}
	}

	/** Events after `sequence`, oldest first, optionally scoped to a session. */
	listAfter(
		sequence: number,
		scope: HubEventLogScope,
		limit: number,
	): HubEventEnvelope[] {
		if (this.closed) {
			return [];
		}
		this.flush();
		const clauses = ["sequence > ?"];
		const params: unknown[] = [sequence];
		if (scope.sessionId) {
			clauses.push("session_id = ?");
			params.push(scope.sessionId);
		}
		params.push(limit);
		return this.db
			.prepare(
				`SELECT sequence, envelope_json FROM hub_events
				 WHERE ${clauses.join(" AND ")} ORDER BY sequence LIMIT ?;`,
			)
			.all(...params)
			.flatMap((row) => {
				try {
					const envelope = JSON.parse(
						String(row.envelope_json),
					) as HubEventEnvelope;
					return [{ ...envelope, sequence: Number(row.sequence) }];
				} catch {
					return [];
				}
			});
	}

	lastSequence(): number {
		if (this.closed) {
			return 0;
		}
		this.flush();
		const row = this.lastSequenceStmt.get();
		return Number(row?.sequence ?? 0);
	}

	/** Bound the log: drop rows past retention, the row cap, and the size budget. */
	prune(now = Date.now()): void {
		if (this.closed) {
			return;
		}
		this.flush();
		this.pruneInternal(now);
	}

	private pruneInternal(now: number): void {
		this.db
			.prepare("DELETE FROM hub_events WHERE created_at < ?;")
			.run(now - this.retentionMs);
		this.db
			.prepare(
				`DELETE FROM hub_events WHERE sequence <= (
					SELECT sequence FROM hub_events ORDER BY sequence DESC
					LIMIT 1 OFFSET ?
				);`,
			)
			.run(this.maxRows);
		// Age/row caps alone don't bound disk: envelopes carrying full session
		// snapshots reach hundreds of KB each, so retained rows could still
		// total tens of GB (#13505). Over budget, keep only the newest rows
		// that fit in half the budget (the newest row — a NULL running sum —
		// is never deleted, so cursors never rewind), then VACUUM: DELETE
		// alone never shrinks the file on disk.
		if (this.fileSizeBytes() > this.maxTotalBytes) {
			this.db
				.prepare(
					`DELETE FROM hub_events WHERE sequence <= (
						SELECT sequence FROM (
							SELECT sequence, SUM(LENGTH(CAST(envelope_json AS BLOB))) OVER (
								ORDER BY sequence DESC
								ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
							) AS newer_bytes FROM hub_events
						)
						WHERE newer_bytes > ? ORDER BY sequence DESC LIMIT 1
					);`,
				)
				.run(Math.floor(this.maxTotalBytes / 2));
			// VACUUM needs scratch space and can fail on a full disk — the
			// very state a ballooned log causes. The deletes above already
			// bound live data, so keep the log running and let the next
			// sweep retry the reclaim once space frees up.
			try {
				this.db.exec("VACUUM;");
			} catch {
				// Retried on the next sweep.
			}
		}
	}

	private fileSizeBytes(): number {
		const pragma = (name: string) =>
			Number(this.db.prepare(`PRAGMA ${name};`).get()?.[name] ?? 0);
		return pragma("page_count") * pragma("page_size");
	}

	close(): void {
		if (this.closed) {
			return;
		}
		try {
			this.flush();
		} finally {
			this.closed = true;
			this.db.close?.();
		}
	}
}
