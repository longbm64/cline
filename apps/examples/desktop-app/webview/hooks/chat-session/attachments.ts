import {
	DEFAULT_MAX_IMAGE_BASE64_BYTES,
	validateImageMedia,
} from "@cline/shared/browser";
import type { ChatMessageImage } from "@/lib/chat-schema";
import { imageAttachmentMediaType } from "@/lib/image-attachments";
import type { SerializedAttachmentFile, SerializedAttachments } from "./types";

type SupportedChatImageMediaType = ChatMessageImage["mediaType"];

type ValidatedImagePayload = {
	mediaType: SupportedChatImageMediaType;
	base64: string;
};

type CachedSerializedItem =
	| { kind: "image"; dataUrl: string; validated?: ValidatedImagePayload }
	| { kind: "file"; file: SerializedAttachmentFile };

type PreviewCacheEntry = {
	previewUrl: string;
	byteSize: number;
	fingerprints: Set<string>;
};

const SUPPORTED_CHAT_IMAGE_MEDIA_TYPE_SET = new Set<string>([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
]);

const MAX_PREVIEW_CACHE_ENTRIES = 32;
const MIN_PREVIEW_CACHE_ENTRIES = 4;
const MAX_PREVIEW_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_PRELOADED_IMAGES = 16;
const MAX_VALIDATED_DATA_URL_CACHE_ENTRIES = 32;
const MAX_REVOKED_PREVIEW_TRACKING = 128;

const previewUrlByFile = new WeakMap<File, string>();
const pendingFileSerialization = new WeakMap<
	File,
	Promise<CachedSerializedItem | null>
>();
const resolvedImageByFile = new WeakMap<File, ValidatedImagePayload>();
const previewEntries: PreviewCacheEntry[] = [];
let previewTotalBytes = 0;
const previewUrlByFingerprint = new Map<string, string>();
const revokedPreviewUrls = new Set<string>();
// Retain recent decoded HTMLImageElement instances so WKWebView keeps their
// decoded bitmap surfaces warm in memory between attach time and send time.
const preloadedImageElements: HTMLImageElement[] = [];
const validatedDataUrlCache = new Map<string, ValidatedImagePayload>();

function isSupportedChatImageMediaType(
	mediaType: string | undefined,
): mediaType is SupportedChatImageMediaType {
	return (
		typeof mediaType === "string" &&
		SUPPORTED_CHAT_IMAGE_MEDIA_TYPE_SET.has(mediaType)
	);
}

function isWithinEncodedImageBudget(byteSize: number): boolean {
	return (
		byteSize > 0 &&
		4 * Math.ceil(byteSize / 3) <= DEFAULT_MAX_IMAGE_BASE64_BYTES
	);
}

function imagePayloadFingerprint(mediaType: string, base64: string): string {
	const len = base64.length;
	if (len <= 384) {
		return `${mediaType}:${len}:${base64}`;
	}
	const step = Math.floor((len - 48) / 7);
	return [
		mediaType,
		len,
		base64.slice(0, 48),
		base64.slice(step, step + 48),
		base64.slice(step * 2, step * 2 + 48),
		base64.slice(step * 3, step * 3 + 48),
		base64.slice(step * 4, step * 4 + 48),
		base64.slice(step * 5, step * 5 + 48),
		base64.slice(step * 6, step * 6 + 48),
		base64.slice(len - 48),
	].join(":");
}

function markPreviewUrlRevoked(previewUrl: string): void {
	revokedPreviewUrls.add(previewUrl);
	if (revokedPreviewUrls.size > MAX_REVOKED_PREVIEW_TRACKING) {
		const oldest = revokedPreviewUrls.values().next().value;
		if (oldest !== undefined) {
			revokedPreviewUrls.delete(oldest);
		}
	}
}

function disposePreviewEntry(entry: PreviewCacheEntry): void {
	previewTotalBytes = Math.max(0, previewTotalBytes - entry.byteSize);
	for (const fingerprint of entry.fingerprints) {
		if (previewUrlByFingerprint.get(fingerprint) === entry.previewUrl) {
			previewUrlByFingerprint.delete(fingerprint);
		}
	}
	markPreviewUrlRevoked(entry.previewUrl);
	if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
		try {
			URL.revokeObjectURL(entry.previewUrl);
		} catch {
			// Ignore revocation errors in non-browser test environments.
		}
	}
}

function prunePreviewEntries(): void {
	while (
		previewEntries.length > MAX_PREVIEW_CACHE_ENTRIES ||
		(previewEntries.length > MIN_PREVIEW_CACHE_ENTRIES &&
			previewTotalBytes > MAX_PREVIEW_CACHE_BYTES)
	) {
		const evicted = previewEntries.shift();
		if (!evicted) break;
		disposePreviewEntry(evicted);
	}
}

function warmDecodedImageElement(previewUrl: string): void {
	if (typeof Image !== "function") {
		return;
	}
	try {
		const img = new Image();
		img.decoding = "async";
		img.src = previewUrl;
		img.decode?.().catch(() => {
			// Ignore decode rejections in headless/test environments.
		});
		preloadedImageElements.push(img);
		while (preloadedImageElements.length > MAX_PRELOADED_IMAGES) {
			preloadedImageElements.shift();
		}
	} catch {
		// Ignore environments without HTMLImageElement support.
	}
}

function getOrCreateImagePreviewUrl(
	file: File,
	mediaType: SupportedChatImageMediaType,
): string | undefined {
	const existing = previewUrlByFile.get(file);
	if (existing && !revokedPreviewUrls.has(existing)) {
		const index = previewEntries.findIndex(
			(entry) => entry.previewUrl === existing,
		);
		if (index >= 0 && index < previewEntries.length - 1) {
			const [entry] = previewEntries.splice(index, 1);
			if (entry) previewEntries.push(entry);
		}
		return existing;
	}
	if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
		return undefined;
	}
	try {
		const source =
			file.type.toLowerCase() === mediaType
				? file
				: new Blob([file], { type: mediaType });
		const previewUrl = URL.createObjectURL(source);
		if (!previewUrl) {
			return undefined;
		}
		revokedPreviewUrls.delete(previewUrl);
		previewUrlByFile.set(file, previewUrl);
		const byteSize = Math.max(0, file.size);
		previewEntries.push({
			previewUrl,
			byteSize,
			fingerprints: new Set(),
		});
		previewTotalBytes += byteSize;
		prunePreviewEntries();
		warmDecodedImageElement(previewUrl);
		return previewUrl;
	} catch {
		return undefined;
	}
}

function registerPreviewUrlForPayload(
	mediaType: SupportedChatImageMediaType,
	base64: string,
	previewUrl: string | undefined,
): void {
	if (!previewUrl || !base64 || revokedPreviewUrls.has(previewUrl)) {
		return;
	}
	const entry = previewEntries.find((item) => item.previewUrl === previewUrl);
	const fingerprint = imagePayloadFingerprint(mediaType, base64);
	previewUrlByFingerprint.set(fingerprint, previewUrl);
	entry?.fingerprints.add(fingerprint);
}

function cacheValidatedDataUrl(
	dataUrl: string,
	payload: ValidatedImagePayload,
): void {
	validatedDataUrlCache.delete(dataUrl);
	validatedDataUrlCache.set(dataUrl, payload);
	if (validatedDataUrlCache.size > MAX_VALIDATED_DATA_URL_CACHE_ENTRIES) {
		const oldest = validatedDataUrlCache.keys().next().value;
		if (oldest !== undefined) {
			validatedDataUrlCache.delete(oldest);
		}
	}
}

function validateCachedImageMedia(
	value: string,
): ValidatedImagePayload | undefined {
	const cached = validatedDataUrlCache.get(value);
	if (cached) {
		return cached;
	}
	const validation = validateImageMedia(undefined, value);
	if (!validation.ok || !isSupportedChatImageMediaType(validation.mediaType)) {
		return undefined;
	}
	const payload: ValidatedImagePayload = {
		mediaType: validation.mediaType,
		base64: validation.base64,
	};
	cacheValidatedDataUrl(value, payload);
	return payload;
}

export function getCachedImagePreviewUrl(
	mediaType: string,
	base64: string,
): string | undefined {
	if (!base64) {
		return undefined;
	}
	const fingerprint = imagePayloadFingerprint(mediaType, base64);
	const previewUrl = previewUrlByFingerprint.get(fingerprint);
	if (!previewUrl) {
		return undefined;
	}
	if (revokedPreviewUrls.has(previewUrl)) {
		previewUrlByFingerprint.delete(fingerprint);
		return undefined;
	}
	return previewUrl;
}

export function evictCachedImagePreviewUrl(previewUrl: string): void {
	if (!previewUrl) {
		return;
	}
	const index = previewEntries.findIndex(
		(entry) => entry.previewUrl === previewUrl,
	);
	if (index >= 0) {
		const [entry] = previewEntries.splice(index, 1);
		if (entry) {
			disposePreviewEntry(entry);
			return;
		}
	}
	markPreviewUrlRevoked(previewUrl);
}

export function resolveChatMessageImageSrc(image: ChatMessageImage): string {
	if (image.previewUrl && !revokedPreviewUrls.has(image.previewUrl)) {
		return image.previewUrl;
	}
	const cachedPreview = getCachedImagePreviewUrl(image.mediaType, image.data);
	if (cachedPreview) {
		return cachedPreview;
	}
	return `data:${image.mediaType};base64,${image.data}`;
}

async function readFileAsDataUrl(file: Blob): Promise<string> {
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

function serializeSingleFile(file: File): Promise<CachedSerializedItem | null> {
	const existing = pendingFileSerialization.get(file);
	if (existing) {
		return existing;
	}
	const task = (async (): Promise<CachedSerializedItem | null> => {
		const mediaType = imageAttachmentMediaType(file);
		if (mediaType) {
			const previewUrl = isSupportedChatImageMediaType(mediaType)
				? getOrCreateImagePreviewUrl(file, mediaType)
				: undefined;
			const source =
				file.type.toLowerCase() === mediaType
					? file
					: new File([file], file.name, { type: mediaType });
			const dataUrl = await readFileAsDataUrl(source);
			if (!dataUrl) {
				return null;
			}
			const validated = validateCachedImageMedia(dataUrl);
			if (validated) {
				resolvedImageByFile.set(file, validated);
				registerPreviewUrlForPayload(
					validated.mediaType,
					validated.base64,
					previewUrl,
				);
			}
			return { kind: "image", dataUrl, validated };
		}

		const content = await readFileAsText(file);
		return {
			kind: "file",
			file: {
				name: file.name,
				content,
			},
		};
	})().catch((error) => {
		pendingFileSerialization.delete(file);
		throw error;
	});
	pendingFileSerialization.set(file, task);
	return task;
}

/**
 * Eagerly creates zero-copy `blob:` preview URLs, pre-decodes image bitmaps
 * off-thread, and pre-serializes base64 payloads while attachments sit in the
 * composer so sending renders user images on the very first frame.
 */
export function warmAttachmentFiles(files: readonly File[]): void {
	for (const file of files) {
		const mediaType = imageAttachmentMediaType(file);
		if (!isSupportedChatImageMediaType(mediaType)) {
			continue;
		}
		if (!isWithinEncodedImageBudget(file.size)) {
			continue;
		}
		getOrCreateImagePreviewUrl(file, mediaType);
		void serializeSingleFile(file).catch(() => undefined);
	}
}

/**
 * Builds synchronous frame-0 image descriptors for an optimistic user bubble
 * directly from attached `File` objects without waiting for `FileReader` or
 * session startup RPCs.
 */
export function toOptimisticChatMessageImages(
	files: readonly File[],
	idPrefix: string,
): ChatMessageImage[] {
	const images: ChatMessageImage[] = [];
	let imageIndex = 0;
	for (const file of files) {
		const mediaType = imageAttachmentMediaType(file);
		if (!mediaType) {
			continue;
		}
		const currentImageIndex = imageIndex;
		imageIndex += 1;
		if (
			!isSupportedChatImageMediaType(mediaType) ||
			!isWithinEncodedImageBudget(file.size)
		) {
			continue;
		}
		const resolved = resolvedImageByFile.get(file);
		const previewUrl = getOrCreateImagePreviewUrl(file, mediaType);
		if (!resolved && !previewUrl) {
			continue;
		}
		images.push({
			id: `${idPrefix}_image_${currentImageIndex}`,
			mediaType: resolved?.mediaType ?? mediaType,
			data: resolved?.base64 ?? "",
			...(previewUrl ? { previewUrl } : {}),
		});
	}
	return images;
}

export async function serializeAttachments(
	files: File[],
): Promise<SerializedAttachments> {
	const items = await Promise.all(
		files.map((file) => serializeSingleFile(file)),
	);
	const userImages: string[] = [];
	const userFiles: SerializedAttachmentFile[] = [];

	for (const item of items) {
		if (!item) continue;
		if (item.kind === "image") {
			userImages.push(item.dataUrl);
		} else {
			userFiles.push(item.file);
		}
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
		const validated = validateCachedImageMedia(value);
		if (!validated) {
			continue;
		}
		images.push({
			id: `${idPrefix}_image_${index}`,
			mediaType: validated.mediaType,
			data: validated.base64,
		});
	}
	return images;
}
