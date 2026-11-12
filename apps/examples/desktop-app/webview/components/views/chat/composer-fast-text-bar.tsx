"use client";

import { Check, Plus, X } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export const COMPOSER_FAST_TEXTS_STORAGE_KEY =
	"cline.code.composer-fast-texts.v1";

const FAST_TEXTS_CHANGED_EVENT = "cline:composer-fast-texts-changed";

function normalizeFastTextItems(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const seen = new Set<string>();
	const items: string[] = [];
	for (const entry of raw) {
		if (typeof entry !== "string") {
			continue;
		}
		const trimmed = entry.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		items.push(trimmed);
	}
	return items;
}

export function readStoredFastTexts(): string[] {
	if (typeof window === "undefined") {
		return [];
	}
	try {
		const raw = window.localStorage.getItem(COMPOSER_FAST_TEXTS_STORAGE_KEY);
		if (!raw) {
			return [];
		}
		return normalizeFastTextItems(JSON.parse(raw));
	} catch {
		return [];
	}
}

export function writeStoredFastTexts(items: readonly string[]): string[] {
	const normalized = normalizeFastTextItems(items);
	if (typeof window !== "undefined") {
		try {
			window.localStorage.setItem(
				COMPOSER_FAST_TEXTS_STORAGE_KEY,
				JSON.stringify(normalized),
			);
			window.dispatchEvent(new CustomEvent(FAST_TEXTS_CHANGED_EVENT));
		} catch {
			// Ignore storage quota / private browsing errors and keep in-memory state.
		}
	}
	return normalized;
}

export type ComposerFastTextBarProps = {
	disabled?: boolean;
	onInsert: (text: string) => void;
	className?: string;
};

export const ComposerFastTextBar = memo(function ComposerFastTextBar({
	disabled = false,
	onInsert,
	className,
}: ComposerFastTextBarProps) {
	const [items, setItems] = useState<string[]>(() => readStoredFastTexts());
	const [adding, setAdding] = useState(false);
	const [draft, setDraft] = useState("");
	const addInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		const syncFromStorage = () => {
			setItems(readStoredFastTexts());
		};
		const handleStorage = (event: StorageEvent) => {
			if (
				event.key === null ||
				event.key === COMPOSER_FAST_TEXTS_STORAGE_KEY
			) {
				syncFromStorage();
			}
		};
		window.addEventListener("storage", handleStorage);
		window.addEventListener(FAST_TEXTS_CHANGED_EVENT, syncFromStorage);
		return () => {
			window.removeEventListener("storage", handleStorage);
			window.removeEventListener(FAST_TEXTS_CHANGED_EVENT, syncFromStorage);
		};
	}, []);

	useEffect(() => {
		if (!adding) {
			return;
		}
		const input = addInputRef.current;
		input?.focus();
		input?.select();
	}, [adding]);

	const handleCommitAdd = useCallback(() => {
		const trimmed = draft.trim();
		if (!trimmed) {
			setDraft("");
			setAdding(false);
			return;
		}
		setItems((current) => {
			if (current.includes(trimmed)) {
				return current;
			}
			return writeStoredFastTexts([...current, trimmed]);
		});
		setDraft("");
		setAdding(false);
	}, [draft]);

	const handleCancelAdd = useCallback(() => {
		setDraft("");
		setAdding(false);
	}, []);

	const handleRemove = useCallback((target: string) => {
		setItems((current) => {
			const next = current.filter((item) => item !== target);
			if (next.length === current.length) {
				return current;
			}
			return writeStoredFastTexts(next);
		});
	}, []);

	return (
		<div
			className={cn(
				"mb-1.5 flex flex-wrap items-center gap-1 px-0.5",
				className,
			)}
			data-testid="composer-fast-text-bar"
		>
			{items.map((item) => (
				<span
					className="group/fast-chip inline-flex max-w-60 items-center rounded-md border border-border/70 bg-surface-1/80 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-surface-hover hover:text-foreground"
					key={item}
				>
					<button
						className="truncate px-2 py-0.5 text-left font-medium leading-4 disabled:pointer-events-none disabled:opacity-50"
						disabled={disabled}
						onClick={() => onInsert(item)}
						title={item}
						type="button"
					>
						{item}
					</button>
					<button
						aria-label={`Remove ${item}`}
						className="inline-flex h-4 w-0 shrink-0 items-center justify-center overflow-hidden rounded-sm text-muted-foreground/70 opacity-0 transition-all duration-100 hover:bg-muted hover:text-foreground focus-visible:mr-0.5 focus-visible:w-4 focus-visible:opacity-100 group-hover/fast-chip:mr-0.5 group-hover/fast-chip:w-4 group-hover/fast-chip:opacity-100 disabled:pointer-events-none"
						disabled={disabled}
						onClick={() => handleRemove(item)}
						title={`Xoá "${item}"`}
						type="button"
					>
						<X className="size-2.5" />
					</button>
				</span>
			))}

			{adding ? (
				<div
					className="inline-flex h-6 items-center gap-0.5 rounded-md border border-primary/50 bg-background px-1.5 ring-1 ring-primary/20"
					onBlur={(event) => {
						const nextTarget = event.relatedTarget as Node | null;
						if (nextTarget && event.currentTarget.contains(nextTarget)) {
							return;
						}
						if (!draft.trim() && nextTarget !== null) {
							handleCancelAdd();
						}
					}}
				>
					<input
						aria-label="Fast text value"
						className="w-40 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.nativeEvent.isComposing || event.keyCode === 229) {
								return;
							}
							if (event.key === "Enter") {
								event.preventDefault();
								event.stopPropagation();
								handleCommitAdd();
							} else if (event.key === "Escape") {
								event.preventDefault();
								event.stopPropagation();
								handleCancelAdd();
							}
						}}
						placeholder="VD: #release, #task, #ask"
						ref={addInputRef}
						type="text"
						value={draft}
					/>
					<button
						aria-label="Save fast text"
						className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground"
						onClick={handleCommitAdd}
						onMouseDown={(event) => event.preventDefault()}
						title="Lưu (Enter)"
						type="button"
					>
						<Check className="size-3" />
					</button>
					<button
						aria-label="Cancel fast text"
						className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground"
						onClick={handleCancelAdd}
						onMouseDown={(event) => event.preventDefault()}
						title="Huỷ (Esc)"
						type="button"
					>
						<X className="size-3" />
					</button>
				</div>
			) : (
				<button
					aria-label="Add fast text"
					className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-surface-1/60 text-muted-foreground transition-colors hover:border-border hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
					disabled={disabled}
					onClick={() => setAdding(true)}
					title="Thêm text nhanh (VD: #release, #task, #ask)"
					type="button"
				>
					<Plus className="size-3.5" />
				</button>
			)}
		</div>
	);
});
