// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import { MessageBubble } from "./message-bubble";

function makeUserMessageWithImage(
	overrides: Partial<ChatMessage> & {
		imageOverrides?: Partial<NonNullable<ChatMessage["images"]>[number]>;
	} = {},
): ChatMessage {
	const { imageOverrides, ...messageOverrides } = overrides;
	return {
		id: "user_1",
		sessionId: "session_1",
		role: "user",
		content: "Check this screenshot",
		images: [
			{
				id: "user_1_image_0",
				mediaType: "image/png",
				data: "",
				previewUrl: "blob:preview-1",
				...imageOverrides,
			},
		],
		createdAt: 1_700_000_000_000,
		meta: { clientRenderKey: "user_1" },
		...messageOverrides,
	};
}

describe("MessageBubble user image rendering", () => {
	let container: HTMLDivElement;
	let root: ReturnType<typeof createRoot>;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	it("renders blob preview immediately and keeps the same <img> mounted across ID/image re-keying", async () => {
		await act(async () => {
			root.render(
				<MessageBubble
					agentRole="user"
					message={makeUserMessageWithImage()}
					reasoningContent=""
					reasoningRedacted={false}
				/>,
			);
		});

		const initialImg = container.querySelector(
			'img[alt="Attachment 1"]',
		) as HTMLImageElement | null;
		expect(initialImg).not.toBeNull();
		expect(initialImg?.getAttribute("src")).toBe("blob:preview-1");

		// Re-keying message.id and image.id (e.g. queued_user_* -> history_*)
		// keeps the exact same <img> element and blob src without re-decoding.
		await act(async () => {
			root.render(
				<MessageBubble
					agentRole="user"
					message={makeUserMessageWithImage({
						id: "queued_user_prompt_1",
						imageOverrides: {
							id: "queued_user_prompt_1_image_0",
							data: "AQID",
							previewUrl: "blob:preview-1",
						},
					})}
					reasoningContent=""
					reasoningRedacted={false}
				/>,
			);
		});

		const updatedImg = container.querySelector(
			'img[alt="Attachment 1"]',
		) as HTMLImageElement | null;
		expect(updatedImg).toBe(initialImg);
		expect(updatedImg?.getAttribute("src")).toBe("blob:preview-1");

		// If the blob URL is ever evicted/revoked, onError seamlessly falls back to base64 data.
		await act(async () => {
			updatedImg?.dispatchEvent(new Event("error"));
		});
		expect(updatedImg?.getAttribute("src")).toBe("data:image/png;base64,AQID");
	});
});
