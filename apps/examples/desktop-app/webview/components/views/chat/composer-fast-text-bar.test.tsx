// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { ChatInputBar } from "./chat-input-bar";
import {
	COMPOSER_FAST_TEXTS_STORAGE_KEY,
	ComposerFastTextBar,
} from "./composer-fast-text-bar";

let container: HTMLDivElement;
let root: Root;

function setInputValue(input: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	window.localStorage.clear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	window.localStorage.clear();
	vi.restoreAllMocks();
});

describe("ComposerFastTextBar", () => {
	it("adds, deduplicates, persists, and removes fast text items", async () => {
		const onInsert = vi.fn();
		await act(async () => {
			root.render(<ComposerFastTextBar onInsert={onInsert} />);
		});

		const addBtn = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Add fast text"]',
		);
		expect(addBtn).not.toBeNull();
		expect(addBtn?.textContent).toBe("");

		await act(async () => {
			addBtn?.click();
		});
		const input = container.querySelector<HTMLInputElement>(
			'input[aria-label="Fast text value"]',
		);
		expect(input).not.toBeNull();

		await act(async () => {
			if (input) setInputValue(input, "  #release  ");
			input?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});

		expect(
			JSON.parse(
				window.localStorage.getItem(COMPOSER_FAST_TEXTS_STORAGE_KEY) ?? "[]",
			),
		).toEqual(["#release"]);

		// Add #task via Save button and verify duplicate #release is ignored.
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('button[aria-label="Add fast text"]')
				?.click();
		});
		const secondInput = container.querySelector<HTMLInputElement>(
			'input[aria-label="Fast text value"]',
		);
		await act(async () => {
			if (secondInput) setInputValue(secondInput, "#task");
			container
				.querySelector<HTMLButtonElement>('button[aria-label="Save fast text"]')
				?.click();
		});

		expect(
			JSON.parse(
				window.localStorage.getItem(COMPOSER_FAST_TEXTS_STORAGE_KEY) ?? "[]",
			),
		).toEqual(["#release", "#task"]);

		// Clicking a fast text calls onInsert; clicking Remove deletes without inserting.
		const releaseButton = Array.from(container.querySelectorAll("button")).find(
			(btn) => btn.textContent === "#release",
		);
		await act(async () => {
			releaseButton?.click();
		});
		expect(onInsert).toHaveBeenCalledTimes(1);
		expect(onInsert).toHaveBeenCalledWith("#release");

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('button[aria-label="Remove #release"]')
				?.click();
		});
		expect(onInsert).toHaveBeenCalledTimes(1);
		expect(
			JSON.parse(
				window.localStorage.getItem(COMPOSER_FAST_TEXTS_STORAGE_KEY) ?? "[]",
			),
		).toEqual(["#task"]);
	});

	it("inserts clicked fast texts directly into ChatInputBar below", async () => {
		window.localStorage.setItem(
			COMPOSER_FAST_TEXTS_STORAGE_KEY,
			JSON.stringify(["#release", "#task", "#ask"]),
		);
		const onPromptInputChange = vi.fn();

		await act(async () => {
			root.render(
				<WorkspaceProvider
					value={{
						workspaceRoot: "/workspace/cline",
						workspaces: ["/workspace/cline"],
						listWorkspaces: vi.fn(async () => ["/workspace/cline"]),
						refreshWorkspaces: vi.fn(async () => undefined),
						switchWorkspace: vi.fn(async () => true),
						pickWorkspaceDirectory: vi.fn(async () => null),
						selectChat: vi.fn(async () => true),
					}}
				>
					<ChatInputBar
						attachments={[]}
						environmentId="local"
						gitBranch="main"
						mode="act"
						model="test-model"
						onAbort={vi.fn()}
						onAttachFiles={vi.fn()}
						onEditPromptInQueue={vi.fn()}
						onListGitBranches={vi.fn(async () => ({
							current: "main",
							branches: ["main"],
						}))}
						onModeToggle={vi.fn()}
						onModelChange={vi.fn()}
						onPromptInputChange={onPromptInputChange}
						onProviderChange={vi.fn()}
						onReasoningChange={vi.fn()}
						onRemoveAttachment={vi.fn()}
						onRemovePromptInQueue={vi.fn()}
						onSend={vi.fn()}
						onSteerPromptInQueue={vi.fn()}
						onSwitchGitBranch={vi.fn(async () => true)}
						promptDraft={{ version: 0, value: "" }}
						promptsInQueue={[]}
						provider="cline"
						reasoningEffort="low"
						status="idle"
						summary={{ additions: 0, deletions: 0 }}
						thinking
					/>
				</WorkspaceProvider>,
			);
			await Promise.resolve();
		});

		const bar = container.querySelector('[data-testid="composer-fast-text-bar"]');
		const composer = container.querySelector(".group\\/composer");
		expect(bar).not.toBeNull();
		expect(composer).not.toBeNull();
		expect(bar?.nextElementSibling).toBe(composer);

		const clickChip = async (label: string) => {
			const button = Array.from(bar?.querySelectorAll("button") ?? []).find(
				(btn) => btn.textContent === label,
			);
			expect(button).toBeDefined();
			await act(async () => {
				button?.click();
			});
		};

		await clickChip("#release");
		const textarea = container.querySelector("textarea");
		expect(textarea?.value).toBe("#release ");
		expect(onPromptInputChange).toHaveBeenLastCalledWith("#release ");

		await clickChip("#task");
		expect(textarea?.value).toBe("#release #task ");
		expect(onPromptInputChange).toHaveBeenLastCalledWith("#release #task ");
	});
});
