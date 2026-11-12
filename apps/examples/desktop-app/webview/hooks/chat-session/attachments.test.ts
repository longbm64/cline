// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	deserializeAttachments,
	evictCachedImagePreviewUrl,
	resolveChatMessageImageSrc,
	serializeAttachments,
	toChatMessageImages,
	toOptimisticChatMessageImages,
	warmAttachmentFiles,
} from "./attachments";

// Minimal valid 1x1 PNG bytes so validateImageMedia accepts the image payload.
const ONE_BY_ONE_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function makePngFile(name: string): File {
	const binary = atob(ONE_BY_ONE_PNG_BASE64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return new File([bytes], name, { type: "image/png" });
}

describe("attachments serialization round-trip", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reconstructs image and text File attachments from queued prompt payloads", async () => {
		const imageFile = makePngFile("screenshot.png");
		const textFile = new File(["line 1\nline 2"], "notes.md", {
			type: "text/markdown",
		});

		const serialized = await serializeAttachments([imageFile, textFile]);
		expect(serialized.userImages).toHaveLength(1);
		expect(serialized.userFiles).toEqual([
			{ name: "notes.md", content: "line 1\nline 2" },
		]);

		const restored = deserializeAttachments(serialized);
		expect(restored).toHaveLength(2);
		expect(restored[0]?.type).toBe("image/png");
		expect(restored[1]?.name).toBe("notes.md");

		const reserialized = await serializeAttachments(restored);
		expect(reserialized).toEqual(serialized);
	});

	it("builds synchronous blob preview images on frame 0 and reuses them across canonical payloads", async () => {
		const originalCreateObjectURL = URL.createObjectURL;
		const originalRevokeObjectURL = URL.revokeObjectURL;
		const createObjectURL = vi.fn(() => "blob:instant-shot-1");
		const revokeObjectURL = vi.fn();
		Object.assign(URL, {
			createObjectURL,
			revokeObjectURL,
		});

		try {
			const imageFile = makePngFile("instant.png");
			const optimistic = toOptimisticChatMessageImages([imageFile], "user_1");
			expect(optimistic).toEqual([
				{
					id: "user_1_image_0",
					mediaType: "image/png",
					data: "",
					previewUrl: "blob:instant-shot-1",
				},
			]);
			const firstOptimistic = optimistic[0];
			expect(firstOptimistic).toBeDefined();
			if (!firstOptimistic) {
				throw new Error("Expected optimistic image");
			}
			expect(resolveChatMessageImageSrc(firstOptimistic)).toBe(
				"blob:instant-shot-1",
			);

			const serialized = await serializeAttachments([imageFile]);
			const canonical = toChatMessageImages(serialized.userImages, "history_1");
			expect(canonical).toHaveLength(1);
			const firstCanonical = canonical[0];
			if (!firstCanonical) {
				throw new Error("Expected canonical image");
			}
			// Canonical history rows omit previewUrl on the schema object yet still
			// resolve to the already-decoded blob URL in this window.
			expect(resolveChatMessageImageSrc(firstCanonical)).toBe(
				"blob:instant-shot-1",
			);

			evictCachedImagePreviewUrl("blob:instant-shot-1");
			expect(revokeObjectURL).toHaveBeenCalledWith("blob:instant-shot-1");
			expect(resolveChatMessageImageSrc(firstCanonical)).toBe(
				`data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`,
			);
		} finally {
			Object.assign(URL, {
				createObjectURL: originalCreateObjectURL,
				revokeObjectURL: originalRevokeObjectURL,
			});
		}
	});

	it("pre-warms base64 image data so optimistic descriptors already carry data when sent", async () => {
		const imageFile = makePngFile("warmed.png");
		warmAttachmentFiles([imageFile]);
		await serializeAttachments([imageFile]);

		const optimistic = toOptimisticChatMessageImages([imageFile], "user_warm");
		expect(optimistic).toEqual([
			expect.objectContaining({
				id: "user_warm_image_0",
				mediaType: "image/png",
				data: ONE_BY_ONE_PNG_BASE64,
			}),
		]);
	});
});
