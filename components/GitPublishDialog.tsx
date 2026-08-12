"use client";

/**
 * Modal for the VSCode-style "publish to GitHub" flow: pick a repository name
 * and private/public visibility, then create the remote and push the current
 * branch. Triggered from the Git panel when a repo has no remote.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-transport";
import { useLocale } from "@/hooks/useLocale";
import { CenteredDialog } from "./CenteredDialog";
import { Icon } from "./Icon";
import { ArrowUp, Github } from "lucide-react";

export function GitPublishDialog({
  open,
  onClose,
  cwd,
  defaultName,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  cwd: string | null;
  defaultName: string;
  onPublished?: (result: { fullName: string; repoUrl: string }) => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState(defaultName);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setVisibility("private");
      setError(null);
    }
  }, [open, defaultName]);

  const create = useCallback(async () => {
    if (!cwd || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/git/push-create-remote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, name: name.trim(), visibility }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; repoUrl?: string; fullName?: string };
      if (!res.ok || data.ok === false) throw new Error(data.error ?? `HTTP ${res.status}`);
      onPublished?.({ fullName: data.fullName ?? "", repoUrl: data.repoUrl ?? "" });
    } catch (e) {
       setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, cwd, name, onPublished, visibility]);

  if (!open) return null;

  return (
    <CenteredDialog width={380} label={t("git.publishTitle")} onClose={busy ? undefined : onClose}>
      <div style={{ padding: "14px 14px 8px", display: "flex", alignItems: "center", gap: 8 }}>
        <Icon icon={Github} size={15} strokeWidth={1.8} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em" }}>{t("git.publishTitle")}</span>
      </div>
      <p style={{ margin: 0, padding: "0 14px 10px", fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>
        {t("git.publishDesc")}
      </p>
      <div style={{ padding: "0 14px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {t("git.publishName")}
          <span style={{ marginLeft: 6, opacity: 0.7 }}>{t("git.publishSuggestName")}</span>
        </label>
        <input
          className="input-base input-mono"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-repository"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
          autoFocus
        />
      </div>
      <div style={{ padding: "0 4px 4px" }}>
        {(["private", "public"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className="menu-row"
            disabled={busy}
            onClick={() => setVisibility(v)}
          >
            <span style={{ flex: 1 }}>{v === "private" ? t("git.private") : t("git.public")}</span>
            {visibility === v ? <span style={{ color: "var(--text)" }}>✓</span> : null}
          </button>
        ))}
      </div>
      {error ? (
        <div style={{ padding: "4px 14px 8px", fontSize: 12, color: "var(--destructive)", lineHeight: 1.4 }}>
          {error}
        </div>
      ) : null}
      <div style={{ height: 1, background: "var(--border)" }} />
      <div style={{ padding: 4 }}>
        <button
          type="button"
          className="menu-row"
          disabled={busy || !name.trim()}
          onClick={() => void create()}
          style={{ opacity: busy || !name.trim() ? 0.45 : 1 }}
        >
          <Icon icon={ArrowUp} size={14} strokeWidth={1.8} />
          <span style={{ flex: 1 }}>{busy ? t("git.publishRunning") : t("git.publishCreate")}</span>
        </button>
        <button type="button" className="menu-row" disabled={busy} onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </CenteredDialog>
  );
}
