let windowFocused = true;
let initialized = false;

function ensureInitialized(): void {
	if (initialized || typeof window === "undefined") {
		return;
	}
	initialized = true;
	window.addEventListener("focus", () => {
		windowFocused = true;
	});
	window.addEventListener("blur", () => {
		windowFocused = false;
	});
}

/**
 * Returns false only after the window has explicitly blurred and has not yet
 * regained focus. Fresh mounts and headless test environments default to true.
 */
export function isAppWindowFocused(): boolean {
	if (typeof window === "undefined") {
		return true;
	}
	ensureInitialized();
	if (
		typeof document !== "undefined" &&
		typeof document.hasFocus === "function" &&
		document.hasFocus()
	) {
		windowFocused = true;
		return true;
	}
	return windowFocused;
}
