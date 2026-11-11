import { validateImageMedia } from "@cline/shared/browser";
import type { ChatMessageImage } from "@/lib/chat-schema";
import { imageAttachmentMediaType } from "@/lib/image-attachments";
import type { SerializedAttachmentFile, SerializedAttachments } from "./types";

async function readFileAsDataUrl(file: File): Promise<string> {
	return await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const value = typeof reader.result === "string" ? reader.result : "";
			resolve(value);
		};
		reader.onerror = () => {
			reject(reader.error ?? new Error("failed reading file"));
		};
		reader.readAsDataURL(file);
	});
}

async function readFileAsText(file: File): Promise<string> {
	if (typeof file.text === "function") {
		return await file.text();
	}
	return await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			resolve(typeof reader.result === "string" ? reader.result : "");
		};
		reader.onerror = () => {
			reject(reader.error ?? new Error("failed reading file"));
		};
		reader.readAsText(file);
	});
}

export async function serializeAttachments(
	files: File[],
): Promise<SerializedAttachments> {
	const userImages: string[] = [];
	const userFiles: SerializedAttachmentFile[] = [];

	for (const file of files) {
		const mediaType = imageAttachmentMediaType(file);
		if (mediaType) {
			const dataUrl = await readFileAsDataUrl(
				new File([file], file.name, { type: mediaType }),
			);
			if (dataUrl) {
				userImages.push(dataUrl);
			}
			continue;
		}

		const content = await readFileAsText(file);
		userFiles.push({
			name: file.name,
			content,
		});
	}

	return { userImages, userFiles };
}

export function deserializeAttachments(
	serialized: Partial<SerializedAttachments> | undefined,
): File[] {
	if (!serialized) return [];
	const files: File[] = [];
	for (const [index, dataUrl] of (serialized.userImages ?? []).entries()) {
		const validation = validateImageMedia(undefined, dataUrl);
		if (!validation.ok) continue;
		try {
			const binary = atob(validation.base64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i += 1) {
				bytes[i] = binary.charCodeAt(i);
			}
			const ext = validation.mediaType.split("/")[1] || "png";
			files.push(
				new File([bytes], `attachment-${index + 1}.${ext}`, {
					type: validation.mediaType,
				}),
			);
		} catch {
			// Skip malformed base64 payloads.
		}
	}
	for (const item of serialized.userFiles ?? []) {
		files.push(
			new File([item.content], item.name || "attachment.txt", {
				type: "text/plain",
			}),
		);
	}
	return files;
}

export function toChatMessageImages(
	userImages: string[],
	idPrefix: string,
): ChatMessageImage[] {
	const images: ChatMessageImage[] = [];
	for (const [index, value] of userImages.entries()) {
		const validation = validateImageMedia(undefined, value);
		if (!validation.ok) {
			continue;
		}
		images.push({
			id: `${idPrefix}_image_${index}`,
			mediaType: validation.mediaType,
			data: validation.base64,
		});
	}
	return images;
}
