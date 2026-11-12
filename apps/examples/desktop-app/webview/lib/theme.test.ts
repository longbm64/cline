// @vitest-environment jsdom

import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	applyHubAccent,
	DEFAULT_HUB_ACCENT,
	DEFAULT_HUB_THEME,
	HUB_ACCENT_STORAGE_KEY,
	HUB_THEME_BOOTSTRAP_SCRIPT,
	HUB_THEME_PRESET_STORAGE_KEY,
	HUB_THEME_PRESETS,
	HUB_THEME_STORAGE_KEY,
	isHubAccent,
	isHubThemePreset,
	readStoredHubAccent,
	readStoredHubTheme,
	readStoredHubThemePreset,
	readSystemHubTheme,
	selectHubThemePreset,
	setStoredHubAccent,
	setStoredHubThemePreset,
	subscribeToHubThemePreset,
	syncHubAccent,
	syncHubTheme,
} from "./theme";

afterEach(() => {
	window.localStorage.clear();
	delete document.body.dataset.vscodeThemeKind;
	document.documentElement.classList.remove("dark");
	delete document.documentElement.dataset.clineAccent;
	delete document.documentElement.dataset.clineHubTheme;
	delete document.documentElement.dataset.clineTheme;
	delete document.documentElement.dataset.theme;
	Reflect.deleteProperty(window, "matchMedia");
});

function setSystemTheme(theme: "light" | "dark" | null): void {
	window.matchMedia = ((query: string) =>
		({
			matches: theme !== null && query === `(prefers-color-scheme: ${theme})`,
			media: query,
			addEventListener() {},
			removeEventListener() {},
		}) as unknown as MediaQueryList) as typeof window.matchMedia;
}

function runThemeBootstrap(): void {
	runInNewContext(HUB_THEME_BOOTSTRAP_SCRIPT, { document, window });
}

describe("hub theme", () => {
	it("applies a saved theme before the system preference", () => {
		setSystemTheme("light");
		window.localStorage.setItem(HUB_THEME_STORAGE_KEY, "dark");

		runThemeBootstrap();

		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.dataset.clineHubTheme).toBe("dark");
	});

	it("applies the system preference before the first paint when unsaved", () => {
		setSystemTheme("light");

		runThemeBootstrap();

		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(document.documentElement.dataset.clineHubTheme).toBe("light");
	});

	it("defaults to dark when no saved or system preference is available", () => {
		expect(readStoredHubTheme()).toBeNull();
		expect(readSystemHubTheme()).toBe(DEFAULT_HUB_THEME);
		expect(syncHubTheme()).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		document.documentElement.classList.remove("dark");
		delete document.documentElement.dataset.clineHubTheme;
		runThemeBootstrap();

		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.dataset.clineHubTheme).toBe("dark");
	});
});

describe("hub theme presets", () => {
	it("includes KAUI and popular developer theme presets", () => {
		const ids = HUB_THEME_PRESETS.map((preset) => preset.id);
		expect(ids).toEqual(
			expect.arrayContaining([
				"system",
				"light",
				"dark",
				"kaui-blue",
				"ocean",
				"sunset",
				"forest",
				"kaui-dark",
				"dracula",
				"tokyo-night",
				"catppuccin-mocha",
				"nord",
				"one-dark",
				"gruvbox-dark",
				"solarized-dark",
				"solarized-light",
			]),
		);
		expect(isHubThemePreset("dracula")).toBe(true);
		expect(isHubThemePreset("sunset")).toBe(true);
		expect(isHubThemePreset("ocean")).toBe(true);
		expect(isHubThemePreset("unknown-theme")).toBe(false);
	});

	it("applies dark and light named presets on html dataset and bootstrap", () => {
		setSystemTheme("light");
		setStoredHubThemePreset("dracula");

		expect(readStoredHubThemePreset()).toBe("dracula");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.dataset.clineHubTheme).toBe("dark");
		expect(document.documentElement.dataset.clineTheme).toBe("dracula");
		expect(document.documentElement.dataset.theme).toBe("dracula");

		setStoredHubThemePreset("sunset");
		expect(readStoredHubThemePreset()).toBe("sunset");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(document.documentElement.dataset.clineHubTheme).toBe("light");
		expect(document.documentElement.dataset.clineTheme).toBe("sunset");
		expect(document.documentElement.dataset.theme).toBe("sunset");

		// Verify pre-paint bootstrap restores named preset and accent cleanly
		setStoredHubAccent("cyan");
		document.documentElement.classList.add("dark");
		delete document.documentElement.dataset.clineTheme;
		delete document.documentElement.dataset.clineAccent;

		runThemeBootstrap();

		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(document.documentElement.dataset.clineTheme).toBe("sunset");
		expect(document.documentElement.dataset.clineAccent).toBe("cyan");
	});

	it("resets custom accent override when selecting a named preset and notifies subscribers", () => {
		const listener = vi.fn();
		const unsubscribe = subscribeToHubThemePreset(listener);

		setStoredHubAccent("pink");
		expect(document.documentElement.dataset.clineAccent).toBe("pink");

		selectHubThemePreset("ocean");
		expect(document.documentElement.dataset.clineTheme).toBe("ocean");
		expect(document.documentElement.dataset.clineAccent).toBeUndefined();
		expect(readStoredHubAccent()).toBe(DEFAULT_HUB_ACCENT);
		expect(listener).toHaveBeenCalledWith("ocean");

		selectHubThemePreset("system");
		expect(document.documentElement.dataset.clineTheme).toBeUndefined();
		expect(readStoredHubTheme()).toBeNull();

		unsubscribe();
	});
});

describe("hub accent", () => {
	it("defaults to violet and validates stored values", () => {
		expect(readStoredHubAccent()).toBe(DEFAULT_HUB_ACCENT);
		window.localStorage.setItem(HUB_ACCENT_STORAGE_KEY, "not-a-color");
		expect(readStoredHubAccent()).toBe(DEFAULT_HUB_ACCENT);
		expect(isHubAccent("ember")).toBe(true);
		expect(isHubAccent("magenta")).toBe(false);
	});

	it("round-trips through storage and the html dataset", () => {
		setStoredHubAccent("graphite");
		expect(window.localStorage.getItem(HUB_ACCENT_STORAGE_KEY)).toBe(
			"graphite",
		);
		expect(document.documentElement.dataset.clineAccent).toBe("graphite");

		expect(syncHubAccent()).toBe("graphite");
		expect(document.documentElement.dataset.clineAccent).toBe("graphite");
	});

	it("clears the dataset attribute for the default accent", () => {
		applyHubAccent("ember");
		expect(document.documentElement.dataset.clineAccent).toBe("ember");
		applyHubAccent(DEFAULT_HUB_ACCENT);
		expect(document.documentElement.dataset.clineAccent).toBeUndefined();
	});
});

describe("preset storage key constant", () => {
	it("uses stable versioned localStorage key", () => {
		expect(HUB_THEME_PRESET_STORAGE_KEY).toBe("cline.code.theme-preset.v1");
	});
});
