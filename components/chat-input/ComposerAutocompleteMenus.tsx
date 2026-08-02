"use client";

import type { MutableRefObject, RefObject } from "react";
import { ComposerPalette } from "../ComposerPalette";
import { FolderIcon, getFileIcon } from "../FileIcons";
import { useLocale } from "@/hooks/useLocale";
import type { MessageKey } from "@/lib/i18n/messages";
import type { AtQueryMatch, FileIndexEntry } from "@/lib/file-fuzzy";
import {
  SLASH_SOURCE_GROUP_KEYS,
  type SlashCommandPaletteItem,
  type SlashCommandSource,
} from "./chat-input-shared";

export type ComposerAutocompleteMenusProps = {
  historyMenuOpen: boolean;
  inputHistory: string[];
  historyActiveIndex: number;
  setHistoryActiveIndex: (i: number) => void;
  applyHistoryInput: (item: string) => void;
  historyMenuRef: RefObject<HTMLDivElement | null>;
  historyItemRefs: MutableRefObject<Array<HTMLButtonElement | null>>;

  slashMenuOpen: boolean;
  slashQuery: string | null;
  slashCommandsLoading?: boolean;
  slashCommandCountLabel: string;
  filteredSlashCommands: SlashCommandPaletteItem[];
  groupedSlashCommands: { source: SlashCommandSource; items: { command: SlashCommandPaletteItem; index: number }[] }[];
  slashActiveIndex: number;
  setSlashActiveIndex: (i: number) => void;
  applySlashCommand: (command: SlashCommandPaletteItem) => void;
  slashItemRefs: MutableRefObject<Array<HTMLButtonElement | null>>;

  atMenuOpen: boolean;
  atQuery: AtQueryMatch | null;
  atMatches: FileIndexEntry[];
  atActiveIndex: number;
  setAtActiveIndex: (i: number) => void;
  applyAtCompletion: (entry: FileIndexEntry) => void;
  atItemRefs: MutableRefObject<Array<HTMLButtonElement | null>>;
  fileIndexLoading: boolean;
  fileIndex: { cwd: string; entries: FileIndexEntry[]; truncated: boolean } | null;
  cwd?: string | null;
  serverResultInUse: boolean;
  needsServerSearch: boolean;
};

export function ComposerAutocompleteMenus(props: ComposerAutocompleteMenusProps) {
  const { t } = useLocale();
  const {
    historyMenuOpen, inputHistory, historyActiveIndex, setHistoryActiveIndex, applyHistoryInput,
    historyMenuRef, historyItemRefs,
    slashMenuOpen, slashQuery, slashCommandsLoading, slashCommandCountLabel,
    filteredSlashCommands, groupedSlashCommands, slashActiveIndex, setSlashActiveIndex,
    applySlashCommand, slashItemRefs,
    atMenuOpen, atQuery, atMatches, atActiveIndex, setAtActiveIndex, applyAtCompletion,
    atItemRefs, fileIndexLoading, fileIndex, cwd, serverResultInUse, needsServerSearch,
  } = props;

  return (
    <>
          {historyMenuOpen && inputHistory.length > 0 && (
            <ComposerPalette
              menuRef={historyMenuRef}
              title={t("chat.inputHistory", { n: String(inputHistory.length) })}
              hint={t("chat.enterToUse")}
              maxHeight="min(44vh, 360px)"
            >
                {inputHistory.map((item, index) => {
                  const active = index === historyActiveIndex;
                  return (
                    <button
                      key={`${index}:${item}`}
                      ref={(node) => {
                        historyItemRefs.current[index] = node;
                      }}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyHistoryInput(item);
                      }}
                      onMouseEnter={() => setHistoryActiveIndex(index)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        padding: "7px 8px",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        background: active ? "var(--bg-selected)" : "none",
                        color: "var(--text)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: 12.5,
                        lineHeight: 1.45,
                      }}
                    >
                      <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", paddingTop: 1 }}>
                        {index + 1}
                      </span>
                      <span style={{ minWidth: 0, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden", overflowWrap: "anywhere" }}>
                        {item}
                      </span>
                    </button>
                  );
                })}
            </ComposerPalette>
          )}
          {slashMenuOpen && slashQuery !== null && (
            <ComposerPalette
              title={slashCommandsLoading ? t("chat.loadingCommands") : t("chat.slashCommands", { n: slashCommandCountLabel })}
              hint={t("chat.tabEnter")}
              maxHeight="min(56vh, 460px)"
              bodyStyle={{ padding: 10 }}
            >
                {!slashCommandsLoading && filteredSlashCommands.length === 0 ? (
                  <div style={{ padding: "2px 2px 4px", fontSize: 12, color: "var(--text-dim)" }}>
                    {t("chat.noCommands")}
                  </div>
                ) : (
                  groupedSlashCommands.map((group) => (
                    <section key={group.source} style={{ marginBottom: 12 }}>
                      <div
                        style={{
                          position: "sticky",
                          top: -10,
                          zIndex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: "4px 0 6px",
                          background: "var(--bg)",
                          color: "var(--text-dim)",
                          fontSize: 10,
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                        <span>{t(SLASH_SOURCE_GROUP_KEYS[group.source])}</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{group.items.length}</span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                          gap: 8,
                        }}
                      >
                        {group.items.map(({ command, index }) => {
                          const active = index === slashActiveIndex;
                          return (
                            <button
                              key={`${command.source}:${command.name}`}
                              ref={(node) => {
                                slashItemRefs.current[index] = node;
                              }}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applySlashCommand(command);
                              }}
                              onMouseEnter={() => setSlashActiveIndex(index)}
                              style={{
                                width: "100%",
                                minWidth: 0,
                                minHeight: 58,
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                                justifyContent: "center",
                                padding: "9px 10px",
                                border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                                borderRadius: "var(--radius-md)",
                                background: active ? "var(--bg-selected)" : "var(--bg-panel)",
                                color: "var(--text)",
                                cursor: "pointer",
                                textAlign: "left",
                                boxShadow: active ? "0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent)" : "none",
                              }}
                            >
                              <span style={{
                                fontSize: 13,
                                fontFamily: "var(--font-mono)",
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                              }}>
                                /{command.name}
                              </span>
                              {command.description && (
                                <span style={{
                                  display: "-webkit-box",
                                  WebkitBoxOrient: "vertical",
                                  WebkitLineClamp: 2,
                                  overflow: "hidden",
                                  fontSize: 11,
                                  lineHeight: 1.35,
                                  color: "var(--text-dim)",
                                }}>
                                  {command.source === "builtin" && command.description.startsWith("chat.")
                                    ? t(command.description as MessageKey)
                                    : command.description}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))
                )}
            </ComposerPalette>
          )}
          {atMenuOpen && atQuery !== null && (() => {
            const indexLoading = fileIndexLoading && (!fileIndex || fileIndex.cwd !== cwd);
            const matchCountLabel = atMatches.length === 1 ? "1 match" : `${atMatches.length} matches`;
            // With a truncated index, local results are provisional — the
            // debounced server search over the full listing replaces them.
            const truncatedHint = fileIndex?.truncated && !serverResultInUse
              ? (atQuery.query ? " · searching all files…" : " · index truncated")
              : "";
            return (
              <ComposerPalette
                title={
                  indexLoading
                    ? t("chat.loadingFiles")
                    : `${t("chat.files", { n: matchCountLabel })}${truncatedHint}`
                }
                hint={t("chat.tabEnter")}
                maxHeight="min(48vh, 400px)"
              >
                  {!indexLoading && atMatches.length === 0 ? (
                    <div style={{ padding: "6px 8px", fontSize: 12, color: "var(--text-dim)" }}>
                      {needsServerSearch && !serverResultInUse ? t("chat.searching") : t("chat.noMatchingFiles")}
                    </div>
                  ) : (
                    atMatches.map((entry, index) => {
                      const active = index === atActiveIndex;
                      const name = entry.path.split("/").pop() ?? entry.path;
                      const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
                      return (
                        <button
                          key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                          ref={(node) => {
                            atItemRefs.current[index] = node;
                          }}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyAtCompletion(entry);
                          }}
                          onMouseEnter={() => setAtActiveIndex(index)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 8px",
                            border: "none",
                            borderRadius: "var(--radius-sm)",
                            background: active ? "var(--bg-selected)" : "none",
                            color: "var(--text)",
                            cursor: "pointer",
                            textAlign: "left",
                            fontSize: 12,
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                            {entry.isDir ? <FolderIcon size={14} /> : getFileIcon(name, 14)}
                          </span>
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {dirPrefix && <span style={{ color: "var(--text-dim)" }}>{dirPrefix}</span>}
                            {name}
                            {entry.isDir && <span style={{ color: "var(--text-dim)" }}>/</span>}
                          </span>
                        </button>
                      );
                    })
                  )}
              </ComposerPalette>
            );
          })()}

    </>
  );
}
