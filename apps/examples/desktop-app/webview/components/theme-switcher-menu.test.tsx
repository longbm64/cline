// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStoredHubThemePreset } from "@/lib/theme";
import { ThemeSwitcherMenu } from "./theme-switcher-menu";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	if (typeof window.localStorage.clear !== "function") {
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: window.sessionStorage,
		});
	}
	window.localStorage.clear();
	document.documentElement.classList.remove("dark");
	delete document.documentElement.dataset.clineTheme;
	delete document.documentElement.dataset.theme;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("ThemeSwitcherMenu", () => {
	it("reflects the active theme preset in the trigger tooltip and opens presets", async () => {
		setStoredHubThemePreset("ocean");

		await act(async () => {
			root.render(<ThemeSwitcherMenu />);
		});

		const trigger = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Change theme"]',
		);
		expect(trigger).not.toBeNull();
		expect(trigger?.getAttribute("title")).toBe("Theme: Ocean");

		await act(async () => {
			setStoredHubThemePreset("dracula");
		});

		expect(trigger?.getAttribute("title")).toBe("Theme: Dracula");
	});
});
