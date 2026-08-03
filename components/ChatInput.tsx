"use client";

import React, { useRef, useState, useCallback, useEffect, useImperativeHandle, useMemo, forwardRef, memo, KeyboardEvent } from "react";
import type { BuiltinSlashCommandResult, QueuedMessages, SlashCommandInfo } from "@/hooks/useAgentSession";
import { clearDraft, getDraft, setDraft, transferDraft } from "@/lib/draft-store";
import {
  MAX_ATTACHED_IMAGE_BYTES,
  MAX_ATTACHED_IMAGES,
} from "@/lib/image-attachments";
import {
  buildEntriesFromFiles, buildAtInsertText, extractAtQuery, filterFileEntries,
  type AtQueryMatch, type FileIndexEntry,
} from "@/lib/file-fuzzy";
import {
  ArrowRight,
  ArrowUpToLine,
  Cpu,
  Image,
  Lightbulb,
  RefreshCw,
  Square,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Icon } from "./Icon";
import { PreviewableImage } from "./PreviewableImage";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLocale } from "@/hooks/useLocale";
import { useContextUsageMetric } from "@/lib/session-metrics-store";
import type { AttachedImage, ChatInputHandle } from "@/lib/chat-input-types";
import { ContextUsageRing } from "./chat-input/ContextUsageRing";
import {
  ModelErrorBanner,
  ModelScopeWarningBanner,
  QueuedMessageRow,
} from "./chat-input/ComposerBanners";
import { ChatInputModelMenu } from "./chat-input/ChatInputModelMenu";
import { ComposerAutocompleteMenus } from "./chat-input/ComposerAutocompleteMenus";
import { ChatInputThinkingMenu } from "./chat-input/ChatInputThinkingMenu";
import { ChatInputModeMenu, agentModeIcon, AGENT_MODE_KEYS } from "./chat-input/ChatInputModeMenu";
import { ComposerContextMenu } from "./chat-input/ComposerContextMenu";
import {
  BUILTIN_SLASH_COMMANDS,
  COMPOSITION_END_ENTER_GRACE_MS,
  MAX_INPUT_HEIGHT,
  MODEL_FILTER_THRESHOLD,
  MODEL_OPTION_COLLATOR,
  SINGLE_LINE_MAX_HEIGHT,
  SLASH_SOURCE_ORDER,
  SLASH_SOURCES,
  THINKING_LEVEL_KEYS,
  compareModelOptions,
  draftImagesToAttachedImages,
  filterModelOptions,
  imageToDraftImage,
  revokeImagePreview,
  slashMatchRank,
  type ModelOption,
  type SlashCommandPaletteItem,
  type SlashCommandSource,
} from "./chat-input/chat-input-shared";
import { parseAgentMode, type AgentMode } from "@/lib/agent-mode";

// Re-export for any external test/import of the pure filter helper.
export { filterModelOptions } from "./chat-input/chat-input-shared";

interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp", images?: AttachedImage[]) => void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  modelError?: string | null;
  modelScopeWarnings?: string[] | null;
  inputHistory?: string[];
  onModelChange?: (provider: string, modelId: string) => void;
  /** Open right-panel Context workspace (context ring next to send). */
  onOpenContext?: () => void;
  /** Called after permission mode is persisted so the host can /reload. */
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  /** When false, image attach / paste / drop is disabled. */
  supportsImageInput?: boolean;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedMessages?: QueuedMessages | null;
  onRecallQueue?: () => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  onAudioUnlock?: () => void;
  draftKey?: string;
  /** Session working directory — enables the @ file autocomplete menu */
  cwd?: string | null;
  /** Unified agent mode (ask/auto/plan/yolo). */
  mode?: AgentMode;
  onModeChange?: (mode: AgentMode) => Promise<{ ok: boolean; error?: string } | void> | void;
  /** Host measures the toolbar strip for the composer underlay — handed over by
   *  ref so the host's ResizeObserver never has to querySelector on each tick. */
  toolbarRef?: React.RefObject<HTMLDivElement | null>;
}


// Memoized: this is a large composer that must not re-render on every
// streaming token reaching ChatWindow.
export const ChatInput = memo(forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, onAbort, onSteer, onFollowUp, isStreaming, model, isAutoModelSelection, modelNames, modelList, modelError, modelScopeWarnings, onModelChange,
  onOpenContext,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  supportsImageInput = false,
  retryInfo, queuedMessages, inputHistory = [], onRecallQueue,
  slashCommands, slashCommandsLoading, onLoadSlashCommands,
  onBuiltinCommand,
  soundEnabled, onSoundToggle, onAudioUnlock,
  onPromptWithStreamingBehavior,
  draftKey,
  cwd,
  mode,
  onModeChange,
  toolbarRef,

}: Props, ref) {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const contextUsage = useContextUsageMetric();
  const contextPct = contextUsage?.percent ?? null;
  const contextPctLabel = contextPct != null ? `${Math.round(contextPct)}%` : null;
  const [value, setValue] = useState(() => (draftKey ? getDraft(draftKey)?.value ?? "" : ""));
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelDropdownRect, setModelDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [thinkingMenuRect, setThinkingMenuRect] = useState<{ top: number; right: number } | null>(null);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const [modeMenuRect, setModeMenuRect] = useState<{ top: number; right: number } | null>(null);
  const [modeBusy, setModeBusy] = useState(false);
  const [controlsMenuOpen, setControlsMenuOpen] = useState(false);

  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(() => (
    draftKey ? draftImagesToAttachedImages(getDraft(draftKey)?.images) : []
  ));
  const trimmedValue = value.trimStart();
  const bashMode = attachedImages.length === 0 && trimmedValue.startsWith("!");
  const bashExcluded = bashMode && trimmedValue.startsWith("!!");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [historyActiveIndex, setHistoryActiveIndex] = useState(0);
  const [composerMenu, setComposerMenu] = useState<{ x: number; y: number } | null>(null);
  const [fileIndex, setFileIndex] = useState<{ cwd: string; entries: FileIndexEntry[]; truncated: boolean } | null>(null);
  const [fileIndexLoading, setFileIndexLoading] = useState(false);
  const [atServerResult, setAtServerResult] = useState<{ cwd: string; query: string; matches: FileIndexEntry[] } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRowRef = useRef<HTMLElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const controlsMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const historyItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileIndexMetaRef = useRef<{ cwd: string; fetchedAt: number } | null>(null);
  const fileIndexFetchingRef = useRef<string | null>(null);
  const draftKeyRef = useRef(draftKey);
  const valueRef = useRef(value);
  const attachedImagesRef = useRef(attachedImages);
  const pendingImageCountRef = useRef(0);
  valueRef.current = value;
  attachedImagesRef.current = attachedImages;

  useImperativeHandle(ref, () => ({
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      setValue(text);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    prependText(text: string) {
      if (!text.trim()) return;
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      // Mirrors the TUI's queue restore: queued text first, then whatever
      // the user already typed, separated by a blank line.
      const combined = [text, current].filter((t) => t.trim()).join("\n\n");
      setValue(combined);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(combined.length, combined.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + (v ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newVal = before + sep + text + after;
      setValue(newVal);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        const pos = start + sep.length + text.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    addImages(files: File[]) {
      processImageFiles(files);
    },
  }));

  const processImageFiles = useCallback(async (files: File[]) => {
    if (isStreaming || !supportsImageInput) return;
    const remaining = Math.max(
      0,
      MAX_ATTACHED_IMAGES - attachedImagesRef.current.length - pendingImageCountRef.current,
    );
    const imageFiles = files
      .filter((f) => f.type.startsWith("image/") && f.size <= MAX_ATTACHED_IMAGE_BYTES)
      .slice(0, remaining);
    if (!imageFiles.length) return;
    pendingImageCountRef.current += imageFiles.length;
    try {
      const newImages = await Promise.all(
        imageFiles.map(
          (file) =>
            new Promise<AttachedImage>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                // result is "data:<mime>;base64,<data>"
                const base64 = result.split(",")[1];
                resolve({ data: base64, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
              };
              reader.onerror = reject;
              reader.readAsDataURL(file);
            })
        )
      );
      setAttachedImages((prev) => {
        const accepted = newImages.slice(0, Math.max(0, MAX_ATTACHED_IMAGES - prev.length));
        newImages.slice(accepted.length).forEach(revokeImagePreview);
        return [...prev, ...accepted];
      });
    } finally {
      pendingImageCountRef.current -= imageFiles.length;
    }
  }, [isStreaming, supportsImageInput]);

  // Drop attached images when switching to a model without vision.
  useEffect(() => {
    if (supportsImageInput) return;
    setAttachedImages((prev) => {
      if (prev.length === 0) return prev;
      for (const img of prev) {
        try { URL.revokeObjectURL(img.previewUrl); } catch { /* ignore */ }
      }
      return [];
    });
  }, [supportsImageInput]);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) revokeImagePreview(removed);
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return [];
    });
  }, []);

  const clearInput = useCallback(() => {
    setValue("");
    setAtQuery(null);
    setHistoryMenuOpen(false);
    if (draftKey) clearDraft(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) clearDraft(draftKeyRef.current);
    clearImages();
    if (textareaRef.current) {
      textareaRef.current.style.height = "32px";
    }
  }, [clearImages, draftKey]);

  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    setDraft(draftKey, {
      value,
      images: attachedImages.map(imageToDraftImage),
    });
  }, [attachedImages, draftKey, value]);

  useEffect(() => {
    const previousDraftKey = draftKeyRef.current;
    if (previousDraftKey === draftKey) return;

    if (previousDraftKey) {
      setDraft(previousDraftKey, {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
      });
    }

    // Promote new-session drafts (`new:<cwd>`) onto the real session id so text
    // typed after the first send is not wiped when the draft key switches.
    let draft = draftKey ? getDraft(draftKey) : null;
    if (!draft && previousDraftKey && draftKey) {
      draft = transferDraft(previousDraftKey, draftKey);
    }
    draftKeyRef.current = draftKey;
    setValue(draft?.value ?? "");
    setAtQuery(null);
    setHistoryMenuOpen(false);
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return draftImagesToAttachedImages(draft?.images);
    });
  }, [draftKey]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Cache the row: the textarea never moves between parents, and `closest()`
    // on every keystroke walks the DOM for nothing.
    let row = inputRowRef.current;
    if (!row) {
      row = ta.closest<HTMLElement>(".composer-input-row");
      inputRowRef.current = row;
    }
    // An empty composer can never be multi-line — reset without measuring, so
    // clearing the input after send costs zero forced layouts.
    if (!value) {
      row?.classList.remove("is-multiline");
      ta.style.lineHeight = "32px";
      ta.style.padding = "0";
      ta.style.height = "32px";
      return;
    }
    // One measurement per keystroke. Reading `scrollHeight` forces a full
    // document layout (the transcript shares the layout tree), so measure
    // directly in multi-line metrics: a single line still floors at the 32px
    // min-height, anything that wraps clears SINGLE_LINE_MAX_HEIGHT.
    ta.style.lineHeight = "1.45";
    ta.style.padding = "6px 0";
    ta.style.height = "auto";
    const natural = ta.scrollHeight;
    const multiline = natural > SINGLE_LINE_MAX_HEIGHT;
    row?.classList.toggle("is-multiline", multiline);
    if (multiline) {
      ta.style.height = `${Math.min(natural, MAX_INPUT_HEIGHT)}px`;
    } else {
      // Single-line metrics: line box equals the control height → true centering.
      ta.style.lineHeight = "32px";
      ta.style.padding = "0";
      ta.style.height = "32px";
    }
  }, [value]);

  useEffect(() => {
    return () => {
      attachedImagesRef.current.forEach(revokeImagePreview);
    };
  }, []);

  const handleSend = useCallback(async () => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    if (isStreaming) return;
    onAudioUnlock?.();
    if (!attachedImages.length && msg.startsWith("/") && onBuiltinCommand) {
      const result = await onBuiltinCommand(msg);
      if (result.handled) {
        if (!result.error) clearInput();
        return;
      }
    }
    onSend(msg, attachedImages.length ? attachedImages : undefined);
    clearInput();
  }, [value, attachedImages, isStreaming, onBuiltinCommand, onSend, clearInput, onAudioUnlock]);

  const slashQuery = value.startsWith("/") && !/\s/.test(value.slice(1))
    ? value.slice(1).toLowerCase()
    : null;

  const filteredSlashCommands = (() => {
    if (slashQuery === null) return [];
    const commands = [...(isStreaming ? [] : BUILTIN_SLASH_COMMANDS), ...(slashCommands ?? [])];
    return [...commands]
      .filter((command) => {
        const name = command.name.toLowerCase();
        const description = command.description?.toLowerCase() ?? "";
        return name.includes(slashQuery) || description.includes(slashQuery);
      })
      .sort((a, b) => {
        const rankDelta = slashMatchRank(a, slashQuery) - slashMatchRank(b, slashQuery);
        if (rankDelta !== 0) return rankDelta;
        return SLASH_SOURCE_ORDER[a.source] - SLASH_SOURCE_ORDER[b.source]
          || MODEL_OPTION_COLLATOR.compare(a.name, b.name);
      });
  })();

  const groupedSlashCommands = (() => {
    const groups = new Map<SlashCommandSource, { source: SlashCommandSource; items: { command: SlashCommandPaletteItem; index: number }[] }>();
    for (const source of SLASH_SOURCES) {
      groups.set(source, { source, items: [] });
    }
    filteredSlashCommands.forEach((command, index) => {
      groups.get(command.source)?.items.push({ command, index });
    });
    return SLASH_SOURCES
      .map((source) => groups.get(source)!)
      .filter((group) => group.items.length > 0);
  })();

  const slashCommandCountLabel = filteredSlashCommands.length === 1
    ? (slashQuery ? "1 match" : "1 command")
    : `${filteredSlashCommands.length} ${slashQuery ? "matches" : "commands"}`;
  const hasInputText = Boolean(value.trim());
  const canQueueStreamingMessage = hasInputText && attachedImages.length === 0;

  // ── @ file autocomplete ──────────────────────────────────────────────────
  // Recomputed from the text before the caret on every change/caret move.
  // Disabled entirely when there is no cwd (new session without a directory).
  const updateAtQuery = useCallback((text: string, cursor: number | null) => {
    if (!cwd) {
      setAtQuery(null);
      return;
    }
    const pos = cursor ?? text.length;
    setAtQuery(extractAtQuery(text.slice(0, pos)));
  }, [cwd]);

  const atQueryText = atQuery?.query ?? null;
  const atLocalMatches: FileIndexEntry[] = React.useMemo(() => (
    atQueryText !== null && fileIndex && fileIndex.cwd === cwd
      ? filterFileEntries(fileIndex.entries, atQueryText)
      : []
  ), [atQueryText, fileIndex, cwd]);

  // When the client index is truncated (repo larger than the index cap),
  // local filtering cannot see deep files, so queries are also ranked
  // server-side against the full listing. Local matches render immediately
  // and are replaced when the (debounced) server result for the current
  // query arrives; stale responses are ignored via the query/cwd tag.
  const needsServerSearch = Boolean(atQueryText && fileIndex?.truncated && fileIndex.cwd === cwd);
  useEffect(() => {
    if (!needsServerSearch || !cwd || !atQueryText) return;
    const fetchCwd = cwd;
    const query = atQueryText;
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}&q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`file search failed: ${res.status}`);
          return res.json() as Promise<{ matches?: FileIndexEntry[] }>;
        })
        .then((data) => setAtServerResult({ cwd: fetchCwd, query, matches: data.matches ?? [] }))
        .catch(() => {
          // Keep showing local matches; the next keystroke retries.
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [needsServerSearch, atQueryText, cwd]);

  const serverResultInUse = needsServerSearch
    && atServerResult !== null
    && atServerResult.cwd === cwd
    && atServerResult.query === atQueryText;
  const atMatches: FileIndexEntry[] = serverResultInUse ? atServerResult.matches : atLocalMatches;

  // Open/reset the menu whenever the @token appears or changes (mirrors the
  // slash menu: Escape closes it, the next keystroke re-opens it).
  const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  // Fetch the file index when the menu opens. The server caches per cwd for
  // ~10s, so re-opening refreshes cheaply; while typing nothing refetches.
  const atTokenActive = atQuery !== null;
  useEffect(() => {
    if (!atTokenActive || !cwd) return;
    const meta = fileIndexMetaRef.current;
    if (meta && meta.cwd === cwd && Date.now() - meta.fetchedAt < 10_000) return;
    if (fileIndexFetchingRef.current === cwd) return;
    fileIndexFetchingRef.current = cwd;
    const fetchCwd = cwd;
    setFileIndexLoading(true);
    fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`file index failed: ${res.status}`);
        return res.json() as Promise<{ files?: string[]; truncated?: boolean }>;
      })
      .then((data) => {
        setFileIndex({ cwd: fetchCwd, entries: buildEntriesFromFiles(data.files ?? []), truncated: !!data.truncated });
        fileIndexMetaRef.current = { cwd: fetchCwd, fetchedAt: Date.now() };
      })
      .catch(() => {
        // Leave any previous index in place; next open retries.
        fileIndexMetaRef.current = null;
      })
      .finally(() => {
        fileIndexFetchingRef.current = null;
        setFileIndexLoading(false);
      });
  }, [atTokenActive, cwd]);

  const applyAtCompletion = useCallback((entry: FileIndexEntry) => {
    if (!atQuery) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? value.length;
    const before = value.slice(0, atQuery.start);
    let after = value.slice(cursor);
    // Completing inside a quoted token (@"my dir/… with the caret before the
    // closing quote): the replacement carries its own closing quote, so drop
    // the old one right after the caret (mirrors the TUI's applyCompletion).
    if (atQuery.quoted && after.startsWith('"')) {
      after = after.slice(1);
    }
    const insert = buildAtInsertText(entry.path, entry.isDir, atQuery.quoted);
    const newValue = before + insert.text + after;
    const newPos = before.length + insert.cursorOffset;
    setValue(newValue);
    // setValue alone does not fire onChange — re-derive the token here. Files
    // end with a space (token closes, menu hides); directories end with "/"
    // before the caret (token stays open for drill-down into the directory).
    setAtQuery(extractAtQuery(newValue.slice(0, newPos)));
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newPos, newPos);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }, [atQuery, value]);

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  useEffect(() => {
    if (!atMenuOpen) return;
    atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atActiveIndex, atMenuOpen]);

  useEffect(() => {
    if (historyActiveIndex >= inputHistory.length) {
      setHistoryActiveIndex(Math.max(0, inputHistory.length - 1));
    }
  }, [inputHistory.length, historyActiveIndex]);

  useEffect(() => {
    historyItemRefs.current.length = inputHistory.length;
  }, [inputHistory.length]);

  useEffect(() => {
    if (!historyMenuOpen) return;
    historyItemRefs.current[historyActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [historyActiveIndex, historyMenuOpen]);

  const applyHistoryInput = useCallback((text: string) => {
    setValue(text);
    setHistoryMenuOpen(false);
    setHistoryActiveIndex(0);
    setAtQuery(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, []);

  const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
    const nextValue = `/${command.name} `;
    setValue(nextValue);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextValue.length, nextValue.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, []);

  const sendQueued = useCallback((mode: "steer" | "followup") => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    if (attachedImages.length) return;
    onAudioUnlock?.();
    const streamingBehavior = mode === "steer" ? "steer" : "followUp";
    if (msg.startsWith("/") && onPromptWithStreamingBehavior) {
      onPromptWithStreamingBehavior(msg, streamingBehavior, attachedImages.length ? attachedImages : undefined);
      clearInput();
      return;
    }
    if (mode === "steer" && onSteer) {
      onSteer(msg, attachedImages.length ? attachedImages : undefined);
    } else if (mode === "followup" && onFollowUp) {
      onFollowUp(msg, attachedImages.length ? attachedImages : undefined);
    }
    clearInput();
  }, [value, attachedImages, onPromptWithStreamingBehavior, onSteer, onFollowUp, clearInput, onAudioUnlock]);

  const getNextSlashIndex = useCallback((direction: "up" | "down" | "left" | "right") => {
    const lastIndex = filteredSlashCommands.length - 1;
    if (lastIndex < 0) return 0;

    if (direction === "left") return Math.max(0, slashActiveIndex - 1);
    if (direction === "right") return Math.min(lastIndex, slashActiveIndex + 1);

    const currentNode = slashItemRefs.current[slashActiveIndex];
    if (!currentNode) {
      return direction === "down"
        ? Math.min(lastIndex, slashActiveIndex + 1)
        : Math.max(0, slashActiveIndex - 1);
    }

    const currentRect = currentNode.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index <= lastIndex; index += 1) {
      if (index === slashActiveIndex) continue;
      const node = slashItemRefs.current[index];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const candidateY = rect.top + rect.height / 2;
      const verticalDelta = candidateY - currentY;
      if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;

      const candidateX = rect.left + rect.width / 2;
      const score = Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
      if (score < bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    if (bestIndex >= 0) return bestIndex;
    return direction === "down"
      ? Math.min(lastIndex, slashActiveIndex + 1)
      : Math.max(0, slashActiveIndex - 1);
  }, [filteredSlashCommands.length, slashActiveIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = e.nativeEvent;
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing =
        isComposingRef.current ||
        nativeEvent.isComposing ||
        nativeEvent.keyCode === 229;

      if (e.key === "Enter" && !e.shiftKey && (isComposing || recentlyComposed)) {
        if (recentlyComposed) e.preventDefault();
        return;
      }

      if (historyMenuOpen && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.min(Math.max(0, inputHistory.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setHistoryMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && inputHistory[historyActiveIndex]) {
          e.preventDefault();
          applyHistoryInput(inputHistory[historyActiveIndex]);
          return;
        }
      }

      if (slashMenuOpen && slashQuery !== null) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("down"));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("up"));
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("right"));
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("left"));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && filteredSlashCommands[slashActiveIndex]) {
          e.preventDefault();
          applySlashCommand(filteredSlashCommands[slashActiveIndex]);
          return;
        }
      }

      // @ file menu — skip while composing so IME candidate navigation
      // (arrows/Enter/Tab) is never intercepted.
      if (atMenuOpen && atQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.min(Math.max(0, atMatches.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAtMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && atMatches[atActiveIndex]) {
          e.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return;
        }
      }

      if (e.key === "ArrowUp" && !isComposing && !isStreaming && inputHistory.length > 0 && value.trim().length === 0) {
        e.preventDefault();
        setSlashMenuOpen(false);
        setAtMenuOpen(false);
        setHistoryActiveIndex(inputHistory.length - 1);
        setHistoryMenuOpen(true);
        return;
      }

      // Esc stops the agent when no slash/@/history menu or IME composition is active.
      if (e.key === "Escape" && !isComposing && isStreaming && onAbort) {
        e.preventDefault();
        onAbort();
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isStreaming && (onSteer || onFollowUp)) {
          // Default Enter sends as steer if available, else followup
          sendQueued(onSteer ? "steer" : "followup");
        } else {
          handleSend();
        }
      }
    },
    [isStreaming, onSteer, onFollowUp, onAbort, slashMenuOpen, slashQuery, filteredSlashCommands, slashActiveIndex, applySlashCommand, sendQueued, handleSend, getNextSlashIndex, atMenuOpen, atQuery, atMatches, atActiveIndex, applyAtCompletion, historyMenuOpen, inputHistory, historyActiveIndex, applyHistoryInput, value]
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!supportsImageInput) return;
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (!imageItems.length) return;
    e.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
    processImageFiles(files);
  }, [processImageFiles, supportsImageInput]);

  useEffect(() => {
    if (slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      slashCommandsRequestedRef.current = false;
      return;
    }
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [slashQuery, onLoadSlashCommands]);

  useEffect(() => {
    if (slashActiveIndex >= filteredSlashCommands.length) {
      setSlashActiveIndex(Math.max(0, filteredSlashCommands.length - 1));
    }
  }, [filteredSlashCommands.length, slashActiveIndex]);

  useEffect(() => {
    slashItemRefs.current.length = filteredSlashCommands.length;
  }, [filteredSlashCommands.length]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashItemRefs.current[slashActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [slashActiveIndex, slashMenuOpen]);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelOption[] = useMemo(() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name })).sort(compareModelOptions);
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    })).sort(compareModelOptions);
  }, [modelList, modelNames, model?.provider]);

  const filteredModelOptions = useMemo(
    () => filterModelOptions(modelOptions, modelFilter),
    [modelOptions, modelFilter],
  );
  const showModelFilter = modelOptions.length > MODEL_FILTER_THRESHOLD;

  // Group options by provider, preserving insertion order
  const modelsByProvider: { provider: string; options: ModelOption[] }[] = useMemo(() => {
    const groups: { provider: string; options: ModelOption[] }[] = [];
    for (const opt of filteredModelOptions) {
      const group = groups.find((g) => g.provider === opt.provider);
      if (group) group.options.push(opt);
      else groups.push({ provider: opt.provider, options: [opt] });
    }
    return groups;
  }, [filteredModelOptions]);

  const displayModelName = model
    ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)?.name ?? model.modelId)
    : null;
  const currentName = displayModelName;

  const thinkingDisplayLabel = t(THINKING_LEVEL_KEYS[thinkingLevel ?? "auto"]);
  const activeMode: AgentMode = parseAgentMode(mode ?? (onModeChange ? "ask" : undefined));
  const modeLabel = t(AGENT_MODE_KEYS[activeMode].label);

  const applyMode = useCallback(async (next: AgentMode) => {
    if (modeBusy || !onModeChange) {
      setModeDropdownOpen(false);
      return;
    }
    setModeBusy(true);
    setModeDropdownOpen(false);
    try {
      await onModeChange(next);
    } finally {
      setModeBusy(false);
    }
  }, [modeBusy, onModeChange]);

  // Close dropdowns on outside click
  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        modelDropdownPanelRef.current && !modelDropdownPanelRef.current.contains(e.target as Node)
      ) {
        setModelDropdownOpen(false);
        setModelFilter("");
      }
      if (thinkingDropdownRef.current && !thinkingDropdownRef.current.contains(e.target as Node)) {
        setThinkingDropdownOpen(false);
      }
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(e.target as Node)) {
        setModeDropdownOpen(false);
      }
      if (controlsMenuRef.current && !controlsMenuRef.current.contains(e.target as Node)) {
        setControlsMenuOpen(false);
      }
      if (historyMenuRef.current && !historyMenuRef.current.contains(e.target as Node) && !textareaRef.current?.contains(e.target as Node)) {
        setHistoryMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!isMobile) setControlsMenuOpen(false);
  }, [isMobile]);

  /** Open a toolbar menu above its trigger using viewport-fixed coords (like model picker). */
  const openFixedMenu = useCallback((
    e: React.MouseEvent<HTMLElement>,
    open: boolean,
    setOpen: (v: boolean | ((prev: boolean) => boolean)) => void,
    setRect: (r: { top: number; right: number } | null) => void,
  ) => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setRect({ top: rect.top, right: rect.right });
    setOpen(true);
  }, []);

  const fixedMenuStyle = useCallback((rect: { top: number; right: number }, minWidth: number): React.CSSProperties => {
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const bottom = viewportHeight - rect.top + 6;
    const maxH = Math.max(120, Math.min(rect.top - 8, viewportHeight * 0.6));
    return {
      position: "fixed",
      bottom,
      right: Math.max(8, viewportWidth - rect.right),
      zIndex: 500,
      minWidth,
      maxHeight: maxH,
      overflowY: "auto",
    };
  }, []);

  return (
    <div
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: "0 16px 8px",
        paddingRight: 16, // right rail is a sibling column now — no extra minimap pad
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        disabled={isStreaming || !supportsImageInput}
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          processImageFiles(files);
          e.target.value = "";
        }}
      />
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <ModelErrorBanner error={modelError} />
        <ModelScopeWarningBanner warnings={modelScopeWarnings} />
        {/* Queued steering / follow-up messages (delivered by pi on upcoming turns) */}
        {((queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0)) > 0 && (
          <div style={{
            marginBottom: 8,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-panel)",
            padding: "5px 0",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "2px 8px 4px 10px",
            }}>
              <span style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "var(--text-dim)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}>
                {t("chat.queued", { n: (queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0) })}
              </span>
              {onRecallQueue && (
                <button
                  onClick={onRecallQueue}
                  title={t("chat.recallQueueTitle")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 12px",
                    fontSize: 12,
                    color: "var(--text)",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    transition: "background 0.12s, border-color 0.12s",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 45%, var(--border))";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <Icon icon={Undo2} size={13} strokeWidth={2} />
                  {t("chat.recallQueue")}
                </button>
              )}
            </div>
            {queuedMessages?.steering.map((text, i) => (
              <QueuedMessageRow key={`steer-${i}`} kind="steer" text={text} />
            ))}
            {queuedMessages?.followUp.map((text, i) => (
              <QueuedMessageRow key={`followup-${i}`} kind="follow-up" text={text} />
            ))}
          </div>
        )}
        {/* Retry banner */}
        {retryInfo && (
          <div style={{
            marginBottom: 8, padding: "5px 10px",
            background: "color-mix(in oklab, var(--text-muted) 10%, transparent)",
            border: "1px solid color-mix(in oklab, var(--text-muted) 28%, var(--border))",
            borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--text)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <Icon icon={RefreshCw} size={11} strokeWidth={2} style={{ flexShrink: 0 }} />
            {t("chat.retrying", { n: retryInfo.attempt, m: retryInfo.maxAttempts })}{retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
          </div>
        )}
        {/* Image previews */}
        {attachedImages.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            {attachedImages.map((img, i) => (
              <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                <PreviewableImage
                  src={img.previewUrl}
                  alt=""
                  className="composer-attach-thumb"
                  previewLabel={t("msg.imagePreview")}
                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "block" }}
                />
                <button
                  onClick={() => removeImage(i)}
                  style={{
                    position: "absolute", top: -4, right: -4,
                    width: 16, height: 16, borderRadius: "50%",
                    background: "var(--bg-panel)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", padding: 0, color: "var(--text-muted)",
                  }}
                >
                  <Icon icon={X} size={8} strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main input */}
        <div style={{ position: "relative" }}>
          <ComposerAutocompleteMenus
            historyMenuOpen={historyMenuOpen}
            inputHistory={inputHistory}
            historyActiveIndex={historyActiveIndex}
            setHistoryActiveIndex={setHistoryActiveIndex}
            applyHistoryInput={applyHistoryInput}
            historyMenuRef={historyMenuRef}
            historyItemRefs={historyItemRefs}
            slashMenuOpen={slashMenuOpen}
            slashQuery={slashQuery}
            slashCommandsLoading={slashCommandsLoading}
            slashCommandCountLabel={slashCommandCountLabel}
            filteredSlashCommands={filteredSlashCommands}
            groupedSlashCommands={groupedSlashCommands}
            slashActiveIndex={slashActiveIndex}
            setSlashActiveIndex={setSlashActiveIndex}
            applySlashCommand={applySlashCommand}
            slashItemRefs={slashItemRefs}
            atMenuOpen={atMenuOpen}
            atQuery={atQuery}
            atMatches={atMatches}
            atActiveIndex={atActiveIndex}
            setAtActiveIndex={setAtActiveIndex}
            applyAtCompletion={applyAtCompletion}
            atItemRefs={atItemRefs}
            fileIndexLoading={fileIndexLoading}
            fileIndex={fileIndex}
            cwd={cwd}
            serverResultInUse={serverResultInUse}
            needsServerSearch={needsServerSearch}
          />
          <div
            className={`composer-shell${isStreaming && (onSteer || onFollowUp) ? " is-streaming" : ""}`}
          >
          <div className="composer-input-row">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setHistoryMenuOpen(false);
              updateAtQuery(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false;
              lastCompositionEndAtRef.current = Date.now();
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onInput={handleInput}
            onPaste={handlePaste}
            onContextMenu={(e) => {
              e.preventDefault();
              setHistoryMenuOpen(false);
              setComposerMenu({ x: e.clientX, y: e.clientY });
            }}
            placeholder={
              isStreaming && (onSteer || onFollowUp)
                ? t("chat.placeholderQueue")
                : isStreaming ? t("chat.placeholderStreaming")
                : t("chat.placeholderIdle")
            }
            rows={1}
            style={{
              flex: 1,
              minWidth: 0,
              maxHeight: 200,
              // Inline fallback so centering works even if CSS class load lags
              boxSizing: "border-box",
              display: "block",
              margin: 0,
              border: "none",
              outline: "none",
              resize: "none",
              background: "transparent",
              color: "var(--text)",
              fontFamily: "inherit",
              fontSize: 14,
              lineHeight: "32px",
              height: 32,
              minHeight: 32,
              padding: 0,
              overflowY: "auto",
            }}
          />
          {composerMenu && (
            <ComposerContextMenu
              x={composerMenu.x}
              y={composerMenu.y}
              textarea={textareaRef.current}
              value={value}
              setValue={setValue}
              onAfterEdit={(next, cursor) => {
                setHistoryMenuOpen(false);
                updateAtQuery(next, cursor);
              }}
              onClose={() => setComposerMenu(null)}
            />
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, alignSelf: "flex-end" }}>
            {/* Context ring — opens right-panel Context workspace */}
            {onOpenContext && (
              <button
                type="button"
                onClick={onOpenContext}
                title={
                  contextPctLabel
                    ? `${t("shell.contextTab")} · ${contextPctLabel}`
                    : t("shell.contextTab")
                }
                aria-label={t("shell.contextTab")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 16,
                  height: 16,
                  padding: 0,
                  margin: "0 2px",
                  border: "none",
                  borderRadius: "50%",
                  background: "transparent",
                  color: "inherit",
                  cursor: "pointer",
                  flexShrink: 0,
                  lineHeight: 0,
                }}
              >
                <ContextUsageRing percent={contextPct} size={14} />
              </button>
            )}
            {isStreaming ? (
              <>
                {onSteer && (
                  <button
                    type="button"
                    className={`chrome-btn${canQueueStreamingMessage ? " is-active" : ""}`}
                    onClick={() => sendQueued("steer")}
                    disabled={!canQueueStreamingMessage}
                    title={attachedImages.length ? t("chat.queueNoImages") : t("chat.steerTitle")}
                  >
                    <Icon icon={ArrowRight} size={12} strokeWidth={1.8} />
                    {t("chat.steer")}
                  </button>
                )}
                {onFollowUp && (
                  <button
                    type="button"
                    className="chrome-btn"
                    onClick={() => sendQueued("followup")}
                    disabled={!canQueueStreamingMessage}
                    title={attachedImages.length ? t("chat.queueNoImages") : t("chat.followUpTitle")}
                  >
                    <Icon icon={ArrowUpToLine} size={12} strokeWidth={1.8} />
                    {t("chat.followUp")}
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={handleSend}
                disabled={!value.trim() && !attachedImages.length}
                style={{
                  flexShrink: 0,
                  display: "flex", alignItems: "center", gap: 6,
                  height: 32, padding: "0 14px",
                  background: (value.trim() || attachedImages.length) ? "var(--accent)" : "var(--bg-panel)",
                  border: "none",
                  borderRadius: "var(--radius-pill)",
                  color: (value.trim() || attachedImages.length) ? "var(--accent-fg)" : "var(--text-dim)",
                  cursor: (value.trim() || attachedImages.length) ? "pointer" : "not-allowed",
                  fontSize: 12,
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                  boxShadow: "none",
                  transition: "background 0.15s, box-shadow 0.15s",
                }}
              >
                <Icon icon={ArrowRight} size={14} strokeWidth={2} />
                {t("chat.send")}
              </button>
            )}
          </div>
          </div>

          {/* Toolbar strip — same chrome language as top bar */}
          <div ref={toolbarRef} className="composer-toolbar">
          {/* LEFT: attach + model selector */}
          <div className={`chrome-controls composer-toolbar-start`} style={{ flex: isMobile ? "1 1 auto" : undefined, minWidth: 0 }}>
            <button
              type="button"
              className={`chrome-btn is-icon${attachedImages.length ? " is-active" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming || !supportsImageInput}
              title={supportsImageInput ? t("chat.attachImage") : t("chat.attachImageDisabled")}
            >
              <Icon icon={Image} size={15} strokeWidth={1.8} />
            </button>
            {/* Model selector — visible always, disabled during streaming */}
            {(modelOptions.length > 0 || currentName || modelError) && onModelChange && (
                <div ref={dropdownRef} style={{ position: "relative", flex: isMobile ? "1 1 auto" : undefined, minWidth: 0 }}>
                  <button
                    type="button"
                    className={`chrome-btn${modelDropdownOpen ? " is-active" : ""}`}
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setModelDropdownRect({ top: rect.top, left: rect.left, width: rect.width });
                      setModelDropdownOpen((open) => {
                        if (open) setModelFilter("");
                        return !open;
                      });
                    }}
                    disabled={isStreaming}
                    title={modelOptions.length > 0 ? (currentName ?? t("chat.changeModel")) : t("chat.noAvailableModels")}
                    aria-label={modelOptions.length > 0 ? (currentName ?? t("chat.changeModel")) : t("chat.noAvailableModels")}
                    style={{
                      justifyContent: isMobile ? "flex-start" : undefined,
                      width: isMobile ? "100%" : undefined,
                      maxWidth: isMobile ? "100%" : undefined,
                      minWidth: 0,
                      overflow: "hidden",
                    }}
                  >
                    <Icon icon={Cpu} size={11} strokeWidth={2} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                      {currentName ?? (modelOptions.length > 0 ? t("chat.selectModel") : t("chat.noModels"))}
                    </span>
                  </button>
                  {modelDropdownOpen && modelDropdownRect && (
                    <ChatInputModelMenu
                      isMobile={isMobile}
                      modelDropdownRect={modelDropdownRect}
                      showModelFilter={showModelFilter}
                      modelFilter={modelFilter}
                      setModelFilter={setModelFilter}
                      setModelDropdownOpen={setModelDropdownOpen}
                      modelsByProvider={modelsByProvider}
                      model={model}
                      isAutoModelSelection={isAutoModelSelection}
                      onModelChange={onModelChange}
                      panelRef={modelDropdownPanelRef}
                    />
                  )}
                </div>
            )}
          </div>

          {!isMobile && <div className="composer-toolbar-spacer" aria-hidden />}
          {!isMobile && <div className="chrome-divider" aria-hidden />}

          {/* RIGHT: thinking + tools preset + compact + sound (idle) | Stop + sound (streaming) */}
          <div ref={controlsMenuRef} className="chrome-controls composer-toolbar-end" style={{
            flex: isMobile ? "0 0 auto" : undefined,
            justifyContent: "flex-end",
            position: "relative",
          }}>
            {isMobile && (
              <button
                type="button"
                className="chrome-btn"
                title={controlsMenuOpen ? undefined : t("chat.moreControls")}
                aria-label={t("chat.moreControls")}
                aria-expanded={controlsMenuOpen}
                aria-hidden={controlsMenuOpen || undefined}
                tabIndex={controlsMenuOpen ? -1 : undefined}
                onClick={() => {
                  setModelDropdownOpen(false);
                  setControlsMenuOpen(true);
                }}
                style={{
                  width: "100%",
                  fontWeight: 500,
                  visibility: controlsMenuOpen ? "hidden" : "visible",
                  pointerEvents: controlsMenuOpen ? "none" : "auto",
                  cursor: controlsMenuOpen ? "default" : "pointer",
                }}
              >
                {t("common.more")}
              </button>
            )}
            <div
              className="chrome-controls"
              style={{
              display: isMobile ? (controlsMenuOpen ? "flex" : "none") : "flex",
              ...(isMobile ? {
                position: "absolute",
                right: 0,
                bottom: 0,
                zIndex: 60,
                padding: 2,
                width: "max-content",
                maxWidth: "calc(100vw - 32px)",
                flexWrap: "nowrap",
                justifyContent: "flex-end",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-panel)",
                boxShadow: "var(--shadow-md)",
              } : null),
            }}>
            {!isStreaming && onThinkingLevelChange && (
              <div ref={thinkingDropdownRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  className={`chrome-btn${thinkingDropdownOpen ? " is-active" : ""}`}
                  onClick={(e) => {
                    if (isStreaming) return;
                    openFixedMenu(e, thinkingDropdownOpen, setThinkingDropdownOpen, setThinkingMenuRect);
                  }}
                  disabled={isStreaming}
                  title={t("chat.changeReasoning", { level: thinkingDisplayLabel })}
                  aria-label={t("chat.changeReasoning", { level: thinkingDisplayLabel })}
                  style={isMobile ? { padding: "0 6px" } : undefined}
                >
                  <Icon icon={Lightbulb} size={11} strokeWidth={1.8} />
                  {(!isMobile || controlsMenuOpen) && <span>{thinkingDisplayLabel}</span>}
                </button>
                {thinkingDropdownOpen && thinkingMenuRect && (
                  <ChatInputThinkingMenu
                    style={fixedMenuStyle(thinkingMenuRect, 112)}
                    thinkingLevel={thinkingLevel}
                    availableThinkingLevels={availableThinkingLevels}
                    thinkingLevelMap={thinkingLevelMap}
                    onThinkingLevelChange={onThinkingLevelChange}
                    setThinkingDropdownOpen={setThinkingDropdownOpen}
                  />
                )}
              </div>
            )}
            {onModeChange !== undefined && (
              <div ref={modeDropdownRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  className={`chrome-btn${modeDropdownOpen ? " is-active" : ""}${activeMode === "yolo" ? " is-danger" : ""}${activeMode === "plan" ? " is-plan" : ""}`}
                  onClick={(e) => {
                    if (modeBusy || isStreaming) return;
                    openFixedMenu(e, modeDropdownOpen, setModeDropdownOpen, setModeMenuRect);
                  }}
                  disabled={modeBusy || isStreaming}
                  title={t("chat.changeMode")}
                  aria-label={t("chat.changeMode")}
                  style={{
                    ...(isMobile ? { padding: "0 6px" } : null),
                    cursor: modeBusy ? "wait" : undefined,
                    opacity: modeBusy ? 0.6 : undefined,
                  }}
                >
                  <Icon icon={agentModeIcon(activeMode)} size={12} strokeWidth={2} />
                  {(!isMobile || controlsMenuOpen) && <span>{modeLabel}</span>}
                </button>
                {modeDropdownOpen && modeMenuRect && (
                  <ChatInputModeMenu
                    style={fixedMenuStyle(modeMenuRect, 240)}
                    mode={activeMode}
                    onModeChange={(next) => void applyMode(next)}
                  />
                )}
              </div>
            )}

            {isStreaming && (
              <button
                type="button"
                className="chrome-btn is-danger is-active"
                onClick={onAbort}
                title={t("chat.stopAgent")}
              >
                <Icon icon={Square} size={10} fill="currentColor" strokeWidth={0} />
                {t("chat.stop")}
              </button>
            )}

            {onSoundToggle !== undefined && (
              <button
                type="button"
                className="chrome-btn is-icon"
                onClick={onSoundToggle}
                title={soundEnabled ? t("chat.soundOn") : t("chat.soundOff")}
                aria-label={soundEnabled ? t("chat.soundOn") : t("chat.soundOff")}
                style={{ opacity: soundEnabled ? 1 : 0.55 }}
              >
                {soundEnabled ? (
                  <Icon icon={Volume2} size={12} strokeWidth={2} />
                ) : (
                  <Icon icon={VolumeX} size={12} strokeWidth={2} />
                )}
              </button>
            )}
            {isMobile && controlsMenuOpen && (
              <button
                type="button"
                title={t("chat.collapseControls")}
                aria-label={t("chat.collapseControls")}
                aria-expanded={true}
                onClick={() => {
                  setThinkingDropdownOpen(false);
                  setControlsMenuOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 32,
                  padding: 0,
                  marginLeft: 0,
                  background: "var(--bg-hover)",
                  border: "none",
                  borderLeft: "1px solid var(--border)",
                  borderRadius: "0 var(--radius-lg) var(--radius-lg) 0",
                  color: "var(--text)",
                  cursor: "pointer",
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-selected)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
              >
                <Icon icon={X} size={13} strokeWidth={2} />
              </button>
            )}
            </div>
          </div>
          </div>
          </div>
        </div>

        {/* Bash mode status label */}
        {bashMode && (
          <div className="text-xs px-2 py-1" style={{ color: bashExcluded ? "var(--text-muted)" : "var(--accent)", marginTop: 4 }}>
            {bashExcluded ? t("chat.shellLocal") : t("chat.shellModel")}
          </div>
        )}
      </div>
    </div>
  );
}));
