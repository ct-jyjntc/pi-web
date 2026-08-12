"use client";

/**
 * Modal for the VSCode-style "publish to GitHub" flow: pick a repository name
 * and private/public visibility, then create the remote and push the current
 * branch. Triggered from the Git panel when a repo has no remote.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-transport";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "./Icon";
import { ArrowUp, Github, X } from "lucide-react";

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
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-shell"
        style={{ width: 380, maxWidth: "calc(100vw - 32px)", padding: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Icon icon={Github} size={16} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            {t("git.publishTitle")}
          </span>
          <button
            type="button"
            className="icon-btn"
            style={{ marginLeft: "auto" }}
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <Icon icon={X} size={14} />
          </button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {t("git.publishDesc")}
          </div>

          <label style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {t("git.publishName")}
            <span style={{ marginLeft: 6, fontStyle: "normal", opacity: 0.7 }}>
              {t("git.publishSuggestName")}
            </span>
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

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {t("git.publishVisibility")}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              {(["private", "public"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => setVisibility(v)}
                  style={{
                    flex: 1,
                    height: 30,
                    fontSize: 12,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    background: visibility === v ? "var(--bg-selected)" : undefined,
                    borderColor: visibility === v ? "var(--ring)" : undefined,
                    color: visibility === v ? "var(--text)" : undefined,
                  }}
                >
                  {visibility === v ? "✓" : ""}
                  {v === "private" ? t("git.private") : t("git.public")}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ fontSize: 12, color: "var(--destructive)", lineHeight: 1.4 }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button type="button" className="btn-ghost" disabled={busy} onClick={onClose} style={{ height: 30, padding: "0 12px", fontSize: 12 }}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !name.trim()}
              onClick={() => void create()}
              style={{ height: 30, padding: "0 14px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Icon icon={ArrowUp} size={12} />
              {busy ? t("git.publishRunning") : t("git.publishCreate")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
