/**
 * Pure helpers and constants for the chat composer (model filter, slash palette, drafts).
 */
import type { SlashCommandInfo } from "@/hooks/useAgentSession";
import type { ChatDraftImage } from "@/lib/draft-store";
import type { MessageKey } from "@/lib/i18n/messages";
import type { AttachedImage } from "@/lib/chat-input-types";
import type { TextContent, UserMessage } from "@/lib/types";
import {
  MAX_ATTACHED_IMAGES,
  extractBase64ImagesFromContent,
  isBase64ImageWithinLimits,
} from "@/lib/image-attachments";

export interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

export const PERMISSION_MODES = ["ask", "full"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const COMPOSITION_END_ENTER_GRACE_MS = 100;
export const COMPOSER_LINE_HEIGHT = 22;
export const COMPOSER_INPUT_MIN_HEIGHT = 45;
export const SINGLE_LINE_MAX_HEIGHT = 44;
export const MAX_INPUT_HEIGHT = 200;
export const MODEL_FILTER_THRESHOLD = 8;
export const MODEL_OPTION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareModelOptions(a: ModelOption, b: ModelOption): number {
  return MODEL_OPTION_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId)
    || MODEL_OPTION_COLLATOR.compare(a.provider, b.provider)
    || MODEL_OPTION_COLLATOR.compare(a.modelId, b.modelId);
}

export function filterModelOptions(options: ModelOption[], query: string): ModelOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return options;
  return options.filter((option) => (
    `${option.name} ${option.modelId}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  ));
}


export const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const THINKING_LEVEL_KEYS: Record<typeof THINKING_LEVELS[number], MessageKey> = {
  auto: "chat.thinkingAuto",
  off: "chat.thinkingOff",
  minimal: "chat.thinkingMinimal",
  low: "chat.thinkingLow",
  medium: "chat.thinkingMedium",
  high: "chat.thinkingHigh",
  xhigh: "chat.thinkingXhigh",
  max: "chat.thinkingMax",
};

export type SlashCommandPaletteItem = SlashCommandInfo | {
  name: string;
  description: string;
  source: "builtin";
};

export type SlashCommandSource = SlashCommandPaletteItem["source"];

export const BUILTIN_SLASH_COMMANDS: SlashCommandPaletteItem[] = [
  { name: "compact", description: "chat.cmdCompact", source: "builtin" },
  { name: "reload", description: "chat.cmdReload", source: "builtin" },
  { name: "name", description: "chat.cmdName", source: "builtin" },
  { name: "session", description: "chat.cmdSession", source: "builtin" },
  { name: "copy", description: "chat.cmdCopy", source: "builtin" },
  { name: "undo", description: "chat.cmdUndo", source: "builtin" },
  { name: "redo", description: "chat.cmdRedo", source: "builtin" },
  { name: "init", description: "chat.cmdInit", source: "builtin" },
];

export const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "custom", "extension", "prompt", "skill"];

export const SLASH_SOURCE_GROUP_KEYS: Record<SlashCommandSource, MessageKey> = {
  builtin: "chat.slashBuiltin",
  custom: "chat.slashCustom",
  extension: "chat.slashExtensions",
  prompt: "chat.slashPrompts",
  skill: "chat.slashSkills",
};

export const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  custom: 1,
  extension: 2,
  prompt: 3,
  skill: 4,
};

export function slashMatchRank(command: SlashCommandPaletteItem, query: string): number {
  const name = command.name.toLowerCase();
  const description = command.description?.toLowerCase() ?? "";
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (description.includes(query)) return 3;
  return 4;
}


export function imageToDraftImage(image: AttachedImage): ChatDraftImage {
  return { data: image.data, mimeType: image.mimeType };
}

export function draftImageToAttachedImage(image: ChatDraftImage): AttachedImage {
  return {
    ...image,
    previewUrl: `data:${image.mimeType};base64,${image.data}`,
  };
}

export function draftImagesToAttachedImages(images: ChatDraftImage[] | undefined): AttachedImage[] {
  return (images ?? [])
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(draftImageToAttachedImage);
}

export function revokeImagePreview(image: AttachedImage): void {
  if (image.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

/** True when the composer has no typed text and no attachments/pending uploads. */
export function canRestoreUserMessage(
  value: string,
  attachedImageCount: number,
  pendingImageCount: number,
): boolean {
  return !value.trim() && attachedImageCount === 0 && pendingImageCount === 0;
}

export function getUserMessageText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/** Extract draftable base64 images from a historical user message (nested or flat pi-ai shape). */
export function getUserMessageDraftImages(message: UserMessage): ChatDraftImage[] {
  if (typeof message.content === "string") return [];
  return extractBase64ImagesFromContent(message.content);
}

/** Prepend recalled draft images onto the composer store, capped and revoking overflow. */
export function prependAttachedImages(
  current: AttachedImage[],
  incoming: ChatDraftImage[] | undefined,
): AttachedImage[] {
  const next = draftImagesToAttachedImages(incoming);
  if (next.length === 0) return current;
  const combined = [...next, ...current];
  const kept = combined.slice(0, MAX_ATTACHED_IMAGES);
  combined.slice(MAX_ATTACHED_IMAGES).forEach(revokeImagePreview);
  return kept;
}
