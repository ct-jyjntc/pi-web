"use client";

/**
 * Full-panel empty / not-a-repo / no-cwd state for the Git review panel.
 * Owns the initialize-repository action so GitPanel does not grow.
 */
import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/api-transport";
import { useLocale } from "@/hooks/useLocale";
import type { GitStatusResponse } from "@/lib/git-types";
import { Icon } from "./Icon";
import { GitBranch } from "lucide-react";

export function GitPanelEmpty({
  kind,
  cwd,
  onInitialized,
}: {
  kind: "no-cwd" | "loading" | "not-repo";
  cwd: string | null;
  onInitialized?: (status: GitStatusResponse) => void;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initRepo = useCallback(async () => {
    if (!cwd || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/git/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      const data = await res.json() as { status?: GitStatusResponse; error?: string };
      if (!res.ok || data.error || !data.status) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onInitialized?.(data.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, cwd, onInitialized]);

  const copy =
    kind === "no-cwd" ? t("git.noCwd")
      : kind === "loading" ? t("git.loading")
        : t("git.notRepo");

  return (
    <div className="git-panel-empty">
      {kind === "not-repo" && (
        <Icon icon={GitBranch} size={16} className="git-panel-empty-icon" />
      )}
      <p className="git-panel-empty-copy">{copy}</p>
      {kind === "not-repo" && (
        <>
          <p className="git-panel-empty-hint">{t("git.initHint")}</p>
          <button
            type="button"
            className="btn-primary btn-compact"
            disabled={busy || !cwd}
            onClick={() => void initRepo()}
          >
            {busy ? t("git.initRunning") : t("git.init")}
          </button>
          {error && <p className="git-panel-empty-error">{error}</p>}
        </>
      )}
    </div>
  );
}
