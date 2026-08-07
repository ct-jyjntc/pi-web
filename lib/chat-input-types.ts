import type { UserMessage } from "@/lib/types";

export interface AttachedImage {
  data: string;
  mimeType: string;
  previewUrl: string;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  /** Fill empty composer with a historical user message (text + images). No-op when draft/pending images exist. */
  replaceMessage: (message: UserMessage) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
  /** Focus the composer textarea (global ⌘/Ctrl+L). */
  focus: () => void;
}
