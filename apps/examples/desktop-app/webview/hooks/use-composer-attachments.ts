import { useEffect, useMemo, useState } from "react";
import { warmAttachmentFiles } from "@/hooks/chat-session/attachments";
import { imageAttachmentMediaType } from "@/lib/image-attachments";

export type ComposerAttachment = {
	id: string;
	name: string;
	isImage: boolean;
	previewUrl?: string;
};

const imagePreviewUrlCache = new WeakMap<File, string>();
const inFlightReads = new WeakMap<File, Promise<string | undefined>>();
const failedImagePreviewFiles = new WeakSet<File>();

function readImagePreviewUrl(
	file: File,
	mediaType: string,
): Promise<string | undefined> {
	const existing = inFlightReads.get(file);
	if (existing) {
		return existing;
	}
	const promise = new Promise<string | undefined>((resolve) => {
		if (typeof FileReader === "undefined") {
			failedImagePreviewFiles.add(file);
			resolve(undefined);
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			const value =
				typeof reader.result === "string" && reader.result.length > 0
					? reader.result
					: undefined;
			if (value) {
				imagePreviewUrlCache.set(file, value);
			} else {
				failedImagePreviewFiles.add(file);
			}
			inFlightReads.delete(file);
			resolve(value);
		};
		reader.onerror = () => {
			failedImagePreviewFiles.add(file);
			inFlightReads.delete(file);
			resolve(undefined);
		};
		const source =
			file.type.toLowerCase() === mediaType
				? file
				: new File([file], file.name, { type: mediaType });
		reader.readAsDataURL(source);
	});
	inFlightReads.set(file, promise);
	return promise;
}

export function useComposerAttachments(
	files: readonly File[],
): ComposerAttachment[] {
	const [resolvedTick, setResolvedTick] = useState(0);

	const attachments = useMemo<ComposerAttachment[]>(() => {
		void resolvedTick;
		return files.map((file, index) => {
			const mediaType = imageAttachmentMediaType(file);
			const isImage = mediaType !== undefined;
			const previewUrl = isImage ? imagePreviewUrlCache.get(file) : undefined;
			return {
				id: `${file.name}:${file.size}:${file.lastModified}:${index}`,
				name: file.name,
				isImage,
				...(previewUrl ? { previewUrl } : {}),
			};
		});
	}, [files, resolvedTick]);

	useEffect(() => {
		let cancelled = false;
		let needsSyncFromCache = false;
		warmAttachmentFiles(files);

		for (const [index, file] of files.entries()) {
			const mediaType = imageAttachmentMediaType(file);
			if (!mediaType) continue;

			if (imagePreviewUrlCache.has(file)) {
				if (!attachments[index]?.previewUrl) {
					needsSyncFromCache = true;
				}
				continue;
			}
			if (failedImagePreviewFiles.has(file)) {
				continue;
			}
			void readImagePreviewUrl(file, mediaType).then((url) => {
				if (!cancelled && url) {
					setResolvedTick((prev) => prev + 1);
				}
			});
		}

		if (needsSyncFromCache) {
			setResolvedTick((prev) => prev + 1);
		}

		return () => {
			cancelled = true;
		};
	}, [attachments, files]);

	return attachments;
}
