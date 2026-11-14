"use client";

import { type AppZoomAction, isAppZoomAction } from "@/lib/app-font-size";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";

export const DESKTOP_ACTION_PENDING_EVENT = "desktop-action-pending";
const TRAY_STATUS_REFRESH_INTERVAL_MS = 15_000;
const TRAY_STATUS_EVENT_DEBOUNCE_MS = 1_000;

export type DesktopAction =
	| { type: "new-session" }
	| { type: "open-settings" }
	| { type: "open-keybindings" }
	| { type: "export-diagnostics" }
	| { type: "check-for-updates" }
	| { type: AppZoomAction }
	| { type: "open-session"; sessionId: string };

type ProcessContext = {
	runningSessionCount?: unknown;
	hub?: {
		status?: unknown;
	};
};

function isDesktopAction(value: unknown): value is DesktopAction {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const action = value as { type?: unknown; sessionId?: unknown };
	if (
		action.type === "new-session" ||
		action.type === "open-settings" ||
		action.type === "open-keybindings" ||
		action.type === "export-diagnostics" ||
		action.type === "check-for-updates" ||
		isAppZoomAction(action.type)
	) {
		return true;
	}
	return (
		action.type === "open-session" &&
		typeof action.sessionId === "string" &&
		action.sessionId.trim().length > 0
	);
}

export function subscribeToDesktopActions(
	onAction: (action: DesktopAction) => void,
): () => void {
	if (!isTauriAvailable()) {
		return () => {};
	}

	let disposed = false;
	let unlisten: (() => void) | undefined;
	let draining = false;
	let drainRequested = false;

	const drainPendingActions = async () => {
		if (disposed) {
			return;
		}
		if (draining) {
			drainRequested = true;
			return;
		}

		draining = true;
		try {
			do {
				drainRequested = false;
				const pending = await desktopClient.invoke<unknown>(
					"drain_desktop_actions",
				);
				if (!Array.isArray(pending)) {
					continue;
				}
				for (const action of pending) {
					if (isDesktopAction(action)) {
						onAction(action);
					}
				}
			} while (drainRequested && !disposed);
		} catch {
			// The native queue retains actions when the drain command fails.
		} finally {
			draining = false;
			if (drainRequested && !disposed) {
				void drainPendingActions();
			}
		}
	};

	void import("@tauri-apps/api/event")
		.then(async ({ listen }) => {
			const stopListening = await listen<void>(
				DESKTOP_ACTION_PENDING_EVENT,
				() => void drainPendingActions(),
			);
			if (disposed) {
				stopListening();
				return;
			}
			unlisten = stopListening;
			// Actions selected before listener registration remain in the native
			// queue, so this initial drain closes the startup delivery gap.
			await drainPendingActions();
		})
		.catch(() => {
			// The browser-only development shell has no native event bridge.
		});

	return () => {
		disposed = true;
		unlisten?.();
	};
}

type TrayStatusSnapshot = {
	hubHealthy: boolean;
	runningSessions: number;
};

async function refreshDesktopTrayStatus(
	lastSnapshot?: TrayStatusSnapshot | null,
): Promise<TrayStatusSnapshot | null> {
	let context: ProcessContext;
	try {
		context = await desktopClient.invoke<ProcessContext>("get_process_context");
	} catch {
		// Preserve the last known status during transient sidecar reconnects.
		return null;
	}

	let runningSessions = 0;
	if (
		typeof context.runningSessionCount === "number" &&
		Number.isFinite(context.runningSessionCount)
	) {
		runningSessions = Math.max(0, Math.floor(context.runningSessionCount));
	}
	const hubHealthy = context.hub?.status === "connected";
	if (
		lastSnapshot &&
		lastSnapshot.hubHealthy === hubHealthy &&
		lastSnapshot.runningSessions === runningSessions
	) {
		return lastSnapshot;
	}

	const nextSnapshot: TrayStatusSnapshot = { hubHealthy, runningSessions };
	try {
		await desktopClient.invoke("set_tray_status", nextSnapshot);
		return nextSnapshot;
	} catch {
		// Tray status is best-effort and unavailable in the browser-only shell.
		return null;
	}
}

export function watchDesktopTrayStatus(): () => void {
	if (!isTauriAvailable()) {
		return () => {};
	}

	let stopped = false;
	let refreshing = false;
	let debounceTimer: number | null = null;
	let lastSnapshot: TrayStatusSnapshot | null = null;
	const refresh = async () => {
		if (stopped || refreshing) {
			return;
		}
		refreshing = true;
		try {
			const updated = await refreshDesktopTrayStatus(lastSnapshot);
			if (updated) {
				lastSnapshot = updated;
			}
		} finally {
			refreshing = false;
		}
	};
	const scheduleRefresh = () => {
		if (stopped || debounceTimer !== null) {
			return;
		}
		debounceTimer = window.setTimeout(() => {
			debounceTimer = null;
			void refresh();
		}, TRAY_STATUS_EVENT_DEBOUNCE_MS);
	};

	void refresh();
	const unsubscribeStatus = desktopClient.subscribe(
		"chat_session_status",
		scheduleRefresh,
	);
	const unsubscribeEnded = desktopClient.subscribe(
		"chat_session_ended",
		scheduleRefresh,
	);
	const unsubscribeChatEvents = desktopClient.subscribe(
		"chat_event",
		(payload) => {
			if (
				payload &&
				typeof payload === "object" &&
				(payload as { stream?: unknown }).stream === "chat_done"
			) {
				scheduleRefresh();
			}
		},
	);
	const interval = window.setInterval(() => {
		if (typeof document !== "undefined" && document.hidden) {
			return;
		}
		void refresh();
	}, TRAY_STATUS_REFRESH_INTERVAL_MS);

	return () => {
		stopped = true;
		if (debounceTimer !== null) {
			window.clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		unsubscribeStatus();
		unsubscribeEnded();
		unsubscribeChatEvents();
		window.clearInterval(interval);
	};
}
