export const MAX_ATTACHED_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHED_IMAGES = 10;

export interface Base64ImageAttachment {
  data: string;
  mimeType: string;
}

function isBase64DataChar(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a)
    || (code >= 0x61 && code <= 0x7a)
    || (code >= 0x30 && code <= 0x39)
    || code === 0x2b
    || code === 0x2f;
}

export function getBase64DecodedByteLength(data: string): number | null {
  if (!data || data.length % 4 !== 0) return null;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const dataEnd = data.length - padding;
  for (let index = 0; index < dataEnd; index += 1) {
    if (!isBase64DataChar(data.charCodeAt(index))) return null;
  }
  for (let index = dataEnd; index < data.length; index += 1) {
    if (data[index] !== "=") return null;
  }
  return (data.length / 4) * 3 - padding;
}

export function isBase64ImageWithinLimits(value: unknown): value is Base64ImageAttachment {
  if (!value || typeof value !== "object") return false;
  const image = value as Partial<Base64ImageAttachment>;
  if (typeof image.data !== "string" || typeof image.mimeType !== "string" || !image.mimeType.startsWith("image/")) {
    return false;
  }
  const bytes = getBase64DecodedByteLength(image.data);
  return bytes !== null && bytes <= MAX_ATTACHED_IMAGE_BYTES;
}

/** Return an API-safe error for prompt, steering, and follow-up image arrays. */
export function validateAgentImages(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "images must be an array";
  if (value.length > MAX_ATTACHED_IMAGES) {
    return `A message can include at most ${MAX_ATTACHED_IMAGES} images`;
  }
  for (const image of value) {
    if (!image || typeof image !== "object" || (image as { type?: unknown }).type !== "image") {
      return "Each attachment must be an image";
    }
    if (!isBase64ImageWithinLimits(image)) {
      return `Each image must be valid base64 image data of ${MAX_ATTACHED_IMAGE_BYTES / (1024 * 1024)}MB or smaller`;
    }
  }
  return null;
}

export type QueueRecallSnapshot = {
  steering?: string[];
  followUp?: string[];
  steeringImages?: Base64ImageAttachment[];
  followUpImages?: Base64ImageAttachment[];
};

/** Pull base64 images from a message content array (nested Anthropic or flat pi-ai). */
export function extractBase64ImagesFromContent(content: unknown): Base64ImageAttachment[] {
  if (!Array.isArray(content)) return [];
  const images: Base64ImageAttachment[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const rec = block as Record<string, unknown>;
    if (rec.type !== "image") continue;
    const source = rec.source;
    let data: unknown = rec.data;
    let mimeType: unknown = rec.mimeType;
    if (source && typeof source === "object") {
      const src = source as Record<string, unknown>;
      if (src.type === "base64") {
        data = src.data;
        mimeType = src.media_type;
      }
    }
    const image = { data, mimeType };
    if (isBase64ImageWithinLimits(image)) images.push({ data: image.data, mimeType: image.mimeType });
  }
  return images;
}

function imagesFromPendingQueue(queue: unknown): Base64ImageAttachment[] {
  if (!queue || typeof queue !== "object") return [];
  const messages = (queue as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return [];
  const images: Base64ImageAttachment[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    images.push(...extractBase64ImagesFromContent((message as { content?: unknown }).content));
  }
  return images;
}

/**
 * Read undelivered images from the agent-core queues (runtime-public fields).
 * Missing / #private queues return empty arrays — recall stays text-only.
 */
export function peekAgentQueueImages(agent: unknown): {
  steering: Base64ImageAttachment[];
  followUp: Base64ImageAttachment[];
} {
  if (!agent || typeof agent !== "object") {
    return { steering: [], followUp: [] };
  }
  const rec = agent as Record<string, unknown>;
  return {
    steering: imagesFromPendingQueue(rec.steeringQueue),
    followUp: imagesFromPendingQueue(rec.followUpQueue),
  };
}

/** Flatten steer + follow-up recall into one composer restore payload. */
export function flattenQueueRecall(result: QueueRecallSnapshot | null | undefined): {
  text: string;
  images: Base64ImageAttachment[];
} {
  const text = [...(result?.steering ?? []), ...(result?.followUp ?? [])]
    .filter((item) => item.trim())
    .join("\n\n");
  const images = [...(result?.steeringImages ?? []), ...(result?.followUpImages ?? [])]
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES);
  return { text, images };
}
