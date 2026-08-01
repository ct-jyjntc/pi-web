export interface AttachedImage {
  data: string;
  mimeType: string;
  previewUrl: string;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
}
