import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSessionHooks } from "./artifacts";

describe("readSessionHooks", () => {
	const dirs: string[] = [];
	const prevHooksPath = process.env.CLINE_HOOKS_LOG_PATH;

	function makeTempDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "cline-artifacts-test-"));
		dirs.push(dir);
		return dir;
	}

	afterEach(() => {
		if (prevHooksPath === undefined) {
			delete process.env.CLINE_HOOKS_LOG_PATH;
		} else {
			process.env.CLINE_HOOKS_LOG_PATH = prevHooksPath;
		}
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("filters by rootSessionId, sessionId, and taskId, preserves chronological tail, and invalidates on updates", async () => {
		const dir = makeTempDir();
		const hooksPath = join(dir, "hooks.jsonl");
		process.env.CLINE_HOOKS_LOG_PATH = hooksPath;

		const lines = [
			JSON.stringify({
				ts: "t1",
				sessionId: "s1",
				hookName: "PostToolUse",
				tool_call: { name: "read_file", input: { path: "a.ts" } },
			}),
			JSON.stringify({
				ts: "t2",
				sessionId: "s2",
				hookName: "PostToolUse",
			}),
			JSON.stringify({
				ts: "t3",
				sessionContext: { rootSessionId: "s1" },
				hook_event_name: "TurnCompleted",
				turn: {
					usage: { inputTokens: 120, outputTokens: 30, totalCost: 0.01 },
				},
			}),
			"not-json-line",
			JSON.stringify({
				ts: "t4",
				taskId: "s1",
				event: "SubagentStop",
			}),
		];
		writeFileSync(hooksPath, `${lines.join("\n")}\n`, "utf8");

		const [firstS1, firstS2] = await Promise.all([
			readSessionHooks("s1", 2),
			readSessionHooks("s2", 10),
		]);
		expect(firstS1).toHaveLength(2);
		expect((firstS1[0] as { ts: string }).ts).toBe("t3");
		expect((firstS1[1] as { ts: string }).ts).toBe("t4");
		expect((firstS1[0] as { inputTokens: number }).inputTokens).toBe(120);
		expect(firstS2).toHaveLength(1);
		expect((firstS2[0] as { ts: string }).ts).toBe("t2");

		writeFileSync(
			hooksPath,
			`${[
				...lines,
				JSON.stringify({ ts: "t5", sessionId: "s1", hookName: "Stop" }),
			].join("\n")}\n`,
			"utf8",
		);
		const updatedS1 = await readSessionHooks("s1", 2);
		expect(updatedS1).toHaveLength(2);
		expect((updatedS1[0] as { ts: string }).ts).toBe("t4");
		expect((updatedS1[1] as { ts: string }).ts).toBe("t5");
	});

	it("returns [] when hooks log file is missing", async () => {
		const dir = makeTempDir();
		process.env.CLINE_HOOKS_LOG_PATH = join(dir, "missing-hooks.jsonl");
		expect(await readSessionHooks("s1")).toEqual([]);
	});
});
