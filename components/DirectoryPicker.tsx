"use client";

import { FormEvent, useCallback, useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronUp, Folder, X } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "./Icon";
import { apiFetch } from "@/lib/api-transport";

interface DirectoryEntry {
  name: string;
  path: string;
}

interface BrowseResponse {
  path?: string;
  parentPath?: string | null;
  directories?: DirectoryEntry[];
  error?: string;
}

async function loadDirectories(directory?: string): Promise<BrowseResponse> {
  const query = directory ? `?path=${encodeURIComponent(directory)}` : "";
  const response = await apiFetch(`/api/cwd/browse${query}`);
  const data = await response.json() as BrowseResponse;
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

interface Props {
  onCancel: () => void;
  onSelect: (path: string) => void;
  busy?: boolean;
  error?: string | null;
}

export function DirectoryPicker({ onCancel, onSelect, busy = false, error }: Props) {
  const { t } = useLocale();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [parentDirectory, setParentDirectory] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const navigateTo = useCallback(async (directory?: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await loadDirectories(directory);
      const nextPath = data.path ?? directory ?? "/";
      setCurrentPath(nextPath);
      setParentDirectory(data.parentPath ?? null);
      setPathInput(nextPath);
      setDirectories(data.directories ?? []);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPortalTarget(document.body);
    void navigateTo();
  }, [navigateTo]);

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = pathInput.trim();
    if (candidate) void navigateTo(candidate);
  };
  const hasUncommittedPath = pathInput.trim() !== currentPath;
  const canSelect = Boolean(currentPath) && !hasUncommittedPath && !busy;

  if (!portalTarget) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("picker.selectDirectory")}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onCancel();
      }}
    >
      <div
        className="modal-shell"
        style={{
          width: 520,
          maxWidth: "calc(100vw - 16px)",
          height: "min(620px, calc(100dvh - 16px))",
          maxHeight: "calc(100dvh - 16px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          padding: 0,
        }}
      >
        <div className="modal-header">
          <div className="modal-header-meta">
            <div className="modal-title">{t("picker.selectDirectory")}</div>
          </div>
          <button
            type="button"
            className="chrome-btn is-icon"
            onClick={onCancel}
            disabled={busy}
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <Icon icon={X} size={14} strokeWidth={1.8} />
          </button>
        </div>

        <form onSubmit={handlePathSubmit} style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <button
            type="button"
            className="icon-btn"
            onClick={() => parentDirectory && void navigateTo(parentDirectory)}
            disabled={loading || !parentDirectory}
            title={t("picker.goParent")}
            aria-label={t("picker.goParent")}
            style={{ "--icon-btn-size": "36px" } as CSSProperties}
          >
            <Icon icon={ChevronUp} size={16} strokeWidth={1.8} />
          </button>
          <label htmlFor="directory-path" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
            {t("picker.directoryPath")}
          </label>
          <input
            id="directory-path"
            className="input-base input-mono"
            type="text"
            value={pathInput}
            placeholder={t("picker.pathPlaceholder")}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setPathInput(event.target.value);
              setLoadError(null);
            }}
            style={{ minWidth: 0, flex: 1, height: 36 }}
          />
          <button
            type="submit"
            className="btn-ghost"
            disabled={loading || !pathInput.trim()}
            title={t("picker.go")}
            style={{ minWidth: 58, height: 36 }}
          >
            {t("picker.go")}
          </button>
        </form>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px 10px" }}>
          {loading ? (
            <div style={{ padding: 8, color: "var(--text-dim)", fontSize: 11 }}>{t("picker.loading")}</div>
          ) : directories.length > 0 ? (
            directories.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => void navigateTo(entry.path)}
                title={entry.path}
                className="modal-nav-item"
                style={{ minHeight: 30, gap: 7, fontFamily: "var(--font-mono)", fontSize: 11 }}
              >
                <Icon icon={Folder} size={14} strokeWidth={1.3} style={{ flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
              </button>
            ))
          ) : (
            <div style={{ padding: 8, color: "var(--text-dim)", fontSize: 11 }}>{t("picker.noSubdirs")}</div>
          )}
          {(loadError || error) && (
            <div style={{ padding: 8, color: "var(--destructive)", fontSize: 11, overflowWrap: "anywhere" }}>
              {loadError ?? error}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onSelect(currentPath)}
            disabled={!canSelect}
            title={hasUncommittedPath ? t("picker.openBeforeSelect") : t("picker.selectCurrent")}
          >
            {busy ? t("common.checking") : t("picker.selectFolder")}
          </button>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
