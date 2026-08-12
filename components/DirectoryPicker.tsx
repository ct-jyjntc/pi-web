"use client";

import { FormEvent, useCallback, useEffect, useState, type CSSProperties } from "react";
import { ChevronUp, Folder } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { CenteredDialog } from "./CenteredDialog";
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
  const [ready, setReady] = useState(false);
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
    setReady(true);
    void navigateTo();
  }, [navigateTo]);

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = pathInput.trim();
    if (candidate) void navigateTo(candidate);
  };
  const hasUncommittedPath = pathInput.trim() !== currentPath;
  const canSelect = Boolean(currentPath) && !hasUncommittedPath && !busy;

  if (!ready) return null;

  return (
    <CenteredDialog
      portal
      width={480}
      label={t("picker.selectDirectory")}
      onClose={busy ? undefined : onCancel}
      style={{ height: "min(560px, calc(100dvh - 32px))", display: "flex", flexDirection: "column" }}
    >
      <div style={{ padding: "12px 14px 8px", fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em" }}>
        {t("picker.selectDirectory")}
      </div>

      <form
        onSubmit={handlePathSubmit}
        style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, padding: "0 14px 10px" }}
      >
        <button
          type="button"
          className="icon-btn"
          onClick={() => parentDirectory && void navigateTo(parentDirectory)}
          disabled={loading || !parentDirectory}
          title={t("picker.goParent")}
          aria-label={t("picker.goParent")}
          style={{ "--icon-btn-size": "30px" } as CSSProperties}
        >
          <Icon icon={ChevronUp} size={15} strokeWidth={1.8} />
        </button>
        <label htmlFor="directory-path" className="sr-only">
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
          style={{ minWidth: 0, flex: 1, height: 30 }}
        />
        <button
          type="submit"
          className="btn-ghost btn-compact"
          disabled={loading || !pathInput.trim()}
          title={t("picker.go")}
        >
          {t("picker.go")}
        </button>
      </form>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 4px" }}>
        {loading ? (
          <div style={{ padding: "8px 10px", color: "var(--text-dim)", fontSize: 12 }}>{t("picker.loading")}</div>
        ) : directories.length > 0 ? (
          directories.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => void navigateTo(entry.path)}
              title={entry.path}
              className="menu-row"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              <Icon icon={Folder} size={13} strokeWidth={1.4} style={{ flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
            </button>
          ))
        ) : (
          <div style={{ padding: "8px 10px", color: "var(--text-dim)", fontSize: 12 }}>{t("picker.noSubdirs")}</div>
        )}
        {(loadError || error) && (
          <div style={{ padding: "8px 10px", color: "var(--destructive)", fontSize: 12, overflowWrap: "anywhere" }}>
            {loadError ?? error}
          </div>
        )}
      </div>

      <div style={{ height: 1, background: "var(--border)" }} />
      <div style={{ padding: 4 }}>
        <button
          type="button"
          className="menu-row"
          onClick={() => onSelect(currentPath)}
          disabled={!canSelect}
          style={{ opacity: canSelect ? 1 : 0.45 }}
        >
          {busy ? t("common.checking") : t("picker.selectFolder")}
        </button>
        <button type="button" className="menu-row" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </button>
      </div>
    </CenteredDialog>
  );
}
