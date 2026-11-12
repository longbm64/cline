export const HUB_THEME_STORAGE_KEY = "cline-hub-theme";
export const HUB_THEME_PRESET_STORAGE_KEY = "cline.code.theme-preset.v1";
export const HUB_THEME_CHANGE_EVENT = "cline-hub-theme-change";
export const HUB_ACCENT_CHANGE_EVENT = "cline-hub-accent-change";

export type HubTheme = "light" | "dark";

export const DEFAULT_HUB_THEME: HubTheme = "dark";

export const HUB_THEME_PRESET_IDS = [
	"system",
	"light",
	"dark",
	"kaui-blue",
	"ocean",
	"sunset",
	"forest",
	"solarized-light",
	"kaui-dark",
	"dracula",
	"tokyo-night",
	"catppuccin-mocha",
	"nord",
	"one-dark",
	"gruvbox-dark",
	"solarized-dark",
] as const;

export type HubThemePresetId = (typeof HUB_THEME_PRESET_IDS)[number];

export const DEFAULT_HUB_THEME_PRESET: HubThemePresetId = "system";

export type HubThemePresetCategory = "mode" | "kaui" | "popular";

export interface HubThemePresetPreview {
	background: string;
	sidebar: string;
	card: string;
	foreground: string;
	muted: string;
	primary: string;
	border: string;
}

export interface HubThemePresetDefinition {
	id: HubThemePresetId;
	label: string;
	description: string;
	mode: HubTheme | "system";
	category: HubThemePresetCategory;
	preview: HubThemePresetPreview;
}

export const HUB_THEME_PRESETS: readonly HubThemePresetDefinition[] = [
	{
		id: "system",
		label: "System",
		description: "Follows OS light & dark mode",
		mode: "system",
		category: "mode",
		preview: {
			background: "#16161d",
			sidebar: "#f4f4f8",
			card: "#24242f",
			foreground: "#f4f4f6",
			muted: "#9ca3af",
			primary: "#635bff",
			border: "#363645",
		},
	},
	{
		id: "light",
		label: "Cline Light",
		description: "Default neutral light",
		mode: "light",
		category: "mode",
		preview: {
			background: "#fbfbfe",
			sidebar: "#f6f6fb",
			card: "#efeef7",
			foreground: "#1d1d26",
			muted: "#5c5c70",
			primary: "#5b5bd6",
			border: "#e2e1ec",
		},
	},
	{
		id: "dark",
		label: "Cline Dark",
		description: "Default neutral dark",
		mode: "dark",
		category: "mode",
		preview: {
			background: "#121216",
			sidebar: "#19191f",
			card: "#212129",
			foreground: "#f5f5f7",
			muted: "#a0a0b0",
			primary: "#6e6ade",
			border: "#2a2a35",
		},
	},
	{
		id: "kaui-blue",
		label: "KAUI Blue",
		description: "Crisp slate & royal blue",
		mode: "light",
		category: "kaui",
		preview: {
			background: "#f8fafc",
			sidebar: "#f1f5f9",
			card: "#eef3f9",
			foreground: "#0f172a",
			muted: "#475569",
			primary: "#2563eb",
			border: "#cbd5e1",
		},
	},
	{
		id: "ocean",
		label: "Ocean",
		description: "Coastal cyan & cool breeze",
		mode: "light",
		category: "kaui",
		preview: {
			background: "#f4fbfd",
			sidebar: "#e8f7fa",
			card: "#e7f6f9",
			foreground: "#0c2a36",
			muted: "#285868",
			primary: "#0e7490",
			border: "#abdce7",
		},
	},
	{
		id: "sunset",
		label: "Sunset",
		description: "Warm amber & sunlit cream",
		mode: "light",
		category: "kaui",
		preview: {
			background: "#fffaf5",
			sidebar: "#fff2e5",
			card: "#fff0e2",
			foreground: "#2a160c",
			muted: "#6b4228",
			primary: "#ea580c",
			border: "#f5cca4",
		},
	},
	{
		id: "forest",
		label: "Forest",
		description: "Emerald pine & soft mint",
		mode: "light",
		category: "kaui",
		preview: {
			background: "#f5fbf7",
			sidebar: "#e8f6ed",
			card: "#e9f5ed",
			foreground: "#0f291a",
			muted: "#2d593f",
			primary: "#15803d",
			border: "#b2dbc1",
		},
	},
	{
		id: "kaui-dark",
		label: "Slate Dark",
		description: "Deep navy slate & crisp blue",
		mode: "dark",
		category: "kaui",
		preview: {
			background: "#0f172a",
			sidebar: "#0b1120",
			card: "#19243a",
			foreground: "#f1f5f9",
			muted: "#9fb0c7",
			primary: "#3b82f6",
			border: "#29374f",
		},
	},
	{
		id: "dracula",
		label: "Dracula",
		description: "Vivid purple on violet night",
		mode: "dark",
		category: "popular",
		preview: {
			background: "#282a36",
			sidebar: "#21222c",
			card: "#313444",
			foreground: "#f8f8f2",
			muted: "#b0bbe0",
			primary: "#bd93f9",
			border: "#44475a",
		},
	},
	{
		id: "tokyo-night",
		label: "Tokyo Night",
		description: "Deep indigo & neon city glow",
		mode: "dark",
		category: "popular",
		preview: {
			background: "#1a1b26",
			sidebar: "#16161e",
			card: "#222536",
			foreground: "#c8d3f5",
			muted: "#9aa5ce",
			primary: "#7aa2f7",
			border: "#333952",
		},
	},
	{
		id: "catppuccin-mocha",
		label: "Catppuccin",
		description: "Soothing pastels on warm mocha",
		mode: "dark",
		category: "popular",
		preview: {
			background: "#1e1e2e",
			sidebar: "#181825",
			card: "#262639",
			foreground: "#cdd6f4",
			muted: "#a6adc8",
			primary: "#cba6f7",
			border: "#3b3c52",
		},
	},
	{
		id: "nord",
		label: "Nord",
		description: "Cool arctic blues & frost",
		mode: "dark",
		category: "popular",
		preview: {
			background: "#2e3440",
			sidebar: "#262b36",
			card: "#373e4d",
			foreground: "#eceff4",
			muted: "#b8c2d1",
			primary: "#88c0d0",
			border: "#465063",
		},
	},
	{
		id: "one-dark",
		label: "One Dark",
		description: "Atom's balanced, easygoing dark",
		mode: "dark",
		category: "popular",
		preview: {
			background: "#282c34",
			sidebar: "#21252b",
			card: "#2f343f",
			foreground: "#e3e6ed",
			muted: "#a9b1c2",
			primary: "#61afef",
			border: "#3e4452",
		},
	},
	{
		id: "gruvbox-dark",
		label: "Gruvbox",
		description: "Retro earthy warmth & amber",
		mode: "dark",
		category: "popular",
		preview: {
			background: "#282828",
			sidebar: "#1d2021",
			card: "#32302f",
			foreground: "#ebdbb2",
			muted: "#c7b89d",
			primary: "#fe8019",
			border: "#47423e",
		},
	},
	{
		id: "solarized-dark",
		label: "Solarized Dark",
		description: "Low-glare deep ocean teal",
		mode: "dark",
		category: "popular",
		preview: {
			background: "#002b36",
			sidebar: "#00212b",
			card: "#073642",
			foreground: "#eee8d5",
			muted: "#9eabac",
			primary: "#268bd2",
			border: "#144b59",
		},
	},
	{
		id: "solarized-light",
		label: "Solarized Light",
		description: "Warm low-glare parchment",
		mode: "light",
		category: "popular",
		preview: {
			background: "#fdf6e3",
			sidebar: "#f3ecda",
			card: "#eee8d5",
			foreground: "#073642",
			muted: "#50666e",
			primary: "#268bd2",
			border: "#d4cdb7",
		},
	},
];

const HUB_THEME_PRESETS_BY_ID = new Map<
	HubThemePresetId,
	HubThemePresetDefinition
>(HUB_THEME_PRESETS.map((preset) => [preset.id, preset]));

const NAMED_PRESET_MODES: Record<string, HubTheme> = Object.fromEntries(
	HUB_THEME_PRESETS.filter(
		(preset): preset is HubThemePresetDefinition & { mode: HubTheme } =>
			preset.id !== "system" && preset.id !== "light" && preset.id !== "dark",
	).map((preset) => [preset.id, preset.mode]),
);

export const HUB_ACCENT_STORAGE_KEY = "cline.code.accent.v1";

/**
 * Accent palettes selectable in Settings. "violet" represents the active
 * theme's built-in accent (untouched `@cline/ui` violet on base themes, or
 * each named preset's signature primary); the others override interactive
 * tokens via `[data-cline-accent]` blocks in globals.css.
 */
export const HUB_ACCENTS = [
	"violet",
	"graphite",
	"cyan",
	"pink",
	"espresso",
	"ember",
] as const;

export type HubAccent = (typeof HUB_ACCENTS)[number];

export const DEFAULT_HUB_ACCENT: HubAccent = "violet";

/**
 * Runs from the document head before the webview paints. Keep this
 * self-contained: the browser executes it before the client bundle loads.
 */
export const HUB_THEME_BOOTSTRAP_SCRIPT = `(() => {
	const root = document.documentElement;
	const presetModes = ${JSON.stringify(NAMED_PRESET_MODES)};
	const validAccents = ${JSON.stringify(HUB_ACCENTS)};
	let theme;
	let namedPreset = null;
	let storedPreset = null;
	let storedTheme = null;
	let storedAccent = null;

	try {
		storedPreset = window.localStorage.getItem(${JSON.stringify(HUB_THEME_PRESET_STORAGE_KEY)});
		storedTheme = window.localStorage.getItem(${JSON.stringify(HUB_THEME_STORAGE_KEY)});
		storedAccent = window.localStorage.getItem(${JSON.stringify(HUB_ACCENT_STORAGE_KEY)});
	} catch {}

	if (storedPreset === "light" || storedPreset === "dark") {
		theme = storedPreset;
	} else if (
		typeof storedPreset === "string" &&
		Object.prototype.hasOwnProperty.call(presetModes, storedPreset)
	) {
		namedPreset = storedPreset;
		theme = presetModes[storedPreset];
	} else if (
		storedPreset !== "system" &&
		(storedTheme === "light" || storedTheme === "dark")
	) {
		theme = storedTheme;
	}

	if (!theme) {
		try {
			if (typeof window.matchMedia === "function") {
				if (window.matchMedia("(prefers-color-scheme: light)").matches) {
					theme = "light";
				} else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
					theme = "dark";
				}
			}
		} catch {}
	}

	if (!theme) {
		theme = ${JSON.stringify(DEFAULT_HUB_THEME)};
	}

	root.classList.toggle("dark", theme === "dark");
	root.dataset.clineHubTheme = theme;
	if (namedPreset) {
		root.dataset.clineTheme = namedPreset;
		root.dataset.theme = namedPreset;
	} else {
		delete root.dataset.clineTheme;
		delete root.dataset.theme;
	}

	if (
		typeof storedAccent === "string" &&
		storedAccent !== ${JSON.stringify(DEFAULT_HUB_ACCENT)} &&
		validAccents.includes(storedAccent)
	) {
		root.dataset.clineAccent = storedAccent;
	} else {
		delete root.dataset.clineAccent;
	}
})();`;

export function isHubThemePreset(value: unknown): value is HubThemePresetId {
	return (
		typeof value === "string" &&
		(HUB_THEME_PRESET_IDS as readonly string[]).includes(value)
	);
}

export function isNamedHubThemePreset(preset: HubThemePresetId): boolean {
	return preset !== "system" && preset !== "light" && preset !== "dark";
}

export function getHubThemePreset(
	preset: HubThemePresetId,
): HubThemePresetDefinition {
	return HUB_THEME_PRESETS_BY_ID.get(preset) ?? HUB_THEME_PRESETS[0];
}

export function readStoredHubTheme(): HubTheme | null {
	try {
		const stored = window.localStorage.getItem(HUB_THEME_STORAGE_KEY);
		return stored === "light" || stored === "dark" ? stored : null;
	} catch {
		return null;
	}
}

export function readStoredHubThemePreset(): HubThemePresetId {
	try {
		const storedPreset = window.localStorage.getItem(
			HUB_THEME_PRESET_STORAGE_KEY,
		);
		if (isHubThemePreset(storedPreset)) {
			return storedPreset;
		}
		const legacyTheme = readStoredHubTheme();
		if (legacyTheme) {
			return legacyTheme;
		}
	} catch {
		// Fall back to system preference when storage is inaccessible.
	}
	return DEFAULT_HUB_THEME_PRESET;
}

export function readSystemHubTheme(): HubTheme {
	const kind = document.body.dataset.vscodeThemeKind;
	if (kind === "vscode-dark" || kind === "vscode-high-contrast") {
		return "dark";
	}
	if (kind === "vscode-light" || kind === "vscode-high-contrast-light") {
		return "light";
	}
	try {
		if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
			return "dark";
		}
		if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
			return "light";
		}
	} catch {
		// Use the app default when the host cannot expose its color scheme.
	}
	return DEFAULT_HUB_THEME;
}

export function resolveHubThemeMode(preset: HubThemePresetId): HubTheme {
	const definition = getHubThemePreset(preset);
	return definition.mode === "system" ? readSystemHubTheme() : definition.mode;
}

function setRootThemeAttributes(
	mode: HubTheme,
	namedPreset: HubThemePresetId | null,
): void {
	const root = document.documentElement;
	root.classList.toggle("dark", mode === "dark");
	root.dataset.clineHubTheme = mode;
	if (namedPreset) {
		root.dataset.clineTheme = namedPreset;
		root.dataset.theme = namedPreset;
	} else {
		delete root.dataset.clineTheme;
		delete root.dataset.theme;
	}
}

function dispatchWindowEvent<T>(name: string, detail: T): void {
	if (typeof window !== "undefined" && typeof CustomEvent === "function") {
		window.dispatchEvent(new CustomEvent<T>(name, { detail }));
	}
}

export function applyHubTheme(theme: HubTheme): HubTheme {
	setRootThemeAttributes(theme, null);
	dispatchWindowEvent<HubThemePresetId>(HUB_THEME_CHANGE_EVENT, theme);
	return theme;
}

export function applyHubThemePreset(
	preset: HubThemePresetId,
): HubThemePresetId {
	const mode = resolveHubThemeMode(preset);
	setRootThemeAttributes(mode, isNamedHubThemePreset(preset) ? preset : null);
	dispatchWindowEvent<HubThemePresetId>(HUB_THEME_CHANGE_EVENT, preset);
	return preset;
}

export function syncHubTheme(): HubTheme {
	const preset = readStoredHubThemePreset();
	applyHubThemePreset(preset);
	return resolveHubThemeMode(preset);
}

export function setStoredHubThemePreset(
	preset: HubThemePresetId,
): HubThemePresetId {
	const mode = resolveHubThemeMode(preset);
	try {
		window.localStorage.setItem(HUB_THEME_PRESET_STORAGE_KEY, preset);
		if (preset === "system") {
			window.localStorage.removeItem(HUB_THEME_STORAGE_KEY);
		} else {
			window.localStorage.setItem(HUB_THEME_STORAGE_KEY, mode);
		}
	} catch {
		// Applying still works for this session when persistence is unavailable.
	}
	return applyHubThemePreset(preset);
}

export function setStoredHubTheme(theme: HubTheme): HubTheme {
	setStoredHubThemePreset(theme);
	return theme;
}

/**
 * User-facing preset selection: persists the chosen preset and, when switching
 * to a named palette (Dracula, Sunset, Ocean, ...), clears any custom accent
 * override so the preset's signature primary color takes effect immediately.
 */
export function selectHubThemePreset(
	preset: HubThemePresetId,
): HubThemePresetId {
	if (isNamedHubThemePreset(preset)) {
		setStoredHubAccent(DEFAULT_HUB_ACCENT);
	}
	return setStoredHubThemePreset(preset);
}

export function isHubAccent(value: unknown): value is HubAccent {
	return (
		typeof value === "string" &&
		(HUB_ACCENTS as readonly string[]).includes(value)
	);
}

export function readStoredHubAccent(): HubAccent {
	try {
		const stored = window.localStorage.getItem(HUB_ACCENT_STORAGE_KEY);
		return isHubAccent(stored) ? stored : DEFAULT_HUB_ACCENT;
	} catch {
		return DEFAULT_HUB_ACCENT;
	}
}

export function applyHubAccent(accent: HubAccent): HubAccent {
	if (accent === DEFAULT_HUB_ACCENT) {
		delete document.documentElement.dataset.clineAccent;
	} else {
		document.documentElement.dataset.clineAccent = accent;
	}
	dispatchWindowEvent<HubAccent>(HUB_ACCENT_CHANGE_EVENT, accent);
	return accent;
}

export function syncHubAccent(): HubAccent {
	return applyHubAccent(readStoredHubAccent());
}

export function setStoredHubAccent(accent: HubAccent): HubAccent {
	try {
		window.localStorage.setItem(HUB_ACCENT_STORAGE_KEY, accent);
	} catch {
		// Accent falls back to default next launch; applying still works now.
	}
	return applyHubAccent(accent);
}

export function subscribeToHubThemePreset(
	onChange: (preset: HubThemePresetId) => void,
): () => void {
	const handleCustom = (event: Event) => {
		if (event instanceof CustomEvent && isHubThemePreset(event.detail)) {
			onChange(event.detail);
		}
	};
	const handleStorage = (event: StorageEvent) => {
		if (
			event.key === null ||
			event.key === HUB_THEME_PRESET_STORAGE_KEY ||
			event.key === HUB_THEME_STORAGE_KEY
		) {
			const next = readStoredHubThemePreset();
			applyHubThemePreset(next);
			onChange(next);
		}
	};
	window.addEventListener(HUB_THEME_CHANGE_EVENT, handleCustom);
	window.addEventListener("storage", handleStorage);
	return () => {
		window.removeEventListener(HUB_THEME_CHANGE_EVENT, handleCustom);
		window.removeEventListener("storage", handleStorage);
	};
}

export function subscribeToHubAccent(
	onChange: (accent: HubAccent) => void,
): () => void {
	const handleCustom = (event: Event) => {
		if (event instanceof CustomEvent && isHubAccent(event.detail)) {
			onChange(event.detail);
		}
	};
	const handleStorage = (event: StorageEvent) => {
		if (event.key === null || event.key === HUB_ACCENT_STORAGE_KEY) {
			const next = readStoredHubAccent();
			applyHubAccent(next);
			onChange(next);
		}
	};
	window.addEventListener(HUB_ACCENT_CHANGE_EVENT, handleCustom);
	window.addEventListener("storage", handleStorage);
	return () => {
		window.removeEventListener(HUB_ACCENT_CHANGE_EVENT, handleCustom);
		window.removeEventListener("storage", handleStorage);
	};
}

/**
 * Follow OS light/dark changes while the user has no explicit fixed preset
 * (or selected "system"), plus cross-window localStorage updates.
 */
export function watchSystemHubTheme(
	onChange?: (theme: HubTheme) => void,
): () => void {
	const media = window.matchMedia?.("(prefers-color-scheme: dark)");
	const handleMedia = () => {
		if (readStoredHubThemePreset() !== "system") {
			return;
		}
		applyHubThemePreset("system");
		onChange?.(readSystemHubTheme());
	};
	const handleStorage = (event: StorageEvent) => {
		if (
			event.key === null ||
			event.key === HUB_THEME_PRESET_STORAGE_KEY ||
			event.key === HUB_THEME_STORAGE_KEY
		) {
			const mode = syncHubTheme();
			onChange?.(mode);
		}
		if (event.key === null || event.key === HUB_ACCENT_STORAGE_KEY) {
			syncHubAccent();
		}
	};
	media?.addEventListener("change", handleMedia);
	window.addEventListener("storage", handleStorage);
	return () => {
		media?.removeEventListener("change", handleMedia);
		window.removeEventListener("storage", handleStorage);
	};
}
