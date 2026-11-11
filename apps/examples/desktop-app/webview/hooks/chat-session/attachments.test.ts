// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { deserializeAttachments, serializeAttachments } from "./attachments";

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
});
