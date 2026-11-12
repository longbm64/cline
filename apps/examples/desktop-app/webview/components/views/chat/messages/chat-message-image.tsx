"use client";

import { useState } from "react";
import {
	evictCachedImagePreviewUrl,
	resolveChatMessageImageSrc,
} from "@/hooks/chat-session/attachments";
import type { ChatMessageImage } from "@/lib/chat-schema";

export function ChatMessageImg({
	alt,
	className,
	image,
}: {
	alt: string;
	className?: string;
	image: ChatMessageImage;
}) {
	const preferredSrc = resolveChatMessageImageSrc(image);
	const fallbackDataSrc = image.data
		? `data:${image.mediaType};base64,${image.data}`
		: undefined;
	const [failedPreviewSrc, setFailedPreviewSrc] = useState<string | null>(null);
	const src =
		failedPreviewSrc === preferredSrc && fallbackDataSrc
			? fallbackDataSrc
			: preferredSrc;

	return (
		// biome-ignore lint/performance/noImgElement: In-memory blob/data URLs do not have static dimensions and cannot use Next's optimizer.
		<img
			alt={alt}
			className={className}
			onError={() => {
				if (
					preferredSrc.startsWith("blob:") &&
					fallbackDataSrc &&
					failedPreviewSrc !== preferredSrc
				) {
					evictCachedImagePreviewUrl(preferredSrc);
					setFailedPreviewSrc(preferredSrc);
				}
			}}
			src={src}
		/>
	);
}
