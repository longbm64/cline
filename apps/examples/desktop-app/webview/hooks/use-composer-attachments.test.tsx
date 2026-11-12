// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type ComposerAttachment,
	useComposerAttachments,
} from "./use-composer-attachments";

describe("useComposerAttachments", () => {
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

	it("resolves data URL previews for image files and keeps non-images as file items", async () => {
		let latest: ComposerAttachment[] = [];
		function Harness({ files }: { files: File[] }) {
			latest = useComposerAttachments(files);
			return null;
		}

		const pngFile = new File(["png-bytes"], "screenshot.png", {
			type: "image/png",
			lastModified: 100,
		});
		const jfifWithoutImageMime = new File(["jpeg-bytes"], "photo.jfif", {
			type: "application/octet-stream",
			lastModified: 200,
		});
		const textFile = new File(["hello"], "notes.txt", {
			type: "text/plain",
			lastModified: 300,
		});
		const files = [pngFile, jfifWithoutImageMime, textFile];

		await act(async () => {
			root.render(<Harness files={files} />);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 25));
		});

		expect(latest).toHaveLength(3);
		expect(latest[0]).toMatchObject({
			name: "screenshot.png",
			isImage: true,
		});
		expect(latest[0]?.previewUrl).toMatch(/^data:image\/png;base64,/);

		expect(latest[1]).toMatchObject({
			name: "photo.jfif",
			isImage: true,
		});
		expect(latest[1]?.previewUrl).toMatch(/^data:image\/jpeg;base64,/);

		expect(latest[2]).toEqual({
			id: `notes.txt:${textFile.size}:300:2`,
			name: "notes.txt",
			isImage: false,
		});

		// Remounting with the same File instance hits the WeakMap cache synchronously.
		let firstRenderOnRemount: ComposerAttachment[] | undefined;
		function RemountHarness({ input }: { input: File[] }) {
			const resolved = useComposerAttachments(input);
			if (firstRenderOnRemount === undefined) {
				firstRenderOnRemount = resolved;
			}
			return null;
		}

		await act(async () => {
			root.render(<RemountHarness input={[pngFile]} />);
		});

		expect(firstRenderOnRemount?.[0]?.previewUrl).toMatch(
			/^data:image\/png;base64,/,
		);
	});
});
