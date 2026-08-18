"use client";

/**
 * Settings → Archived: lists soft-archived sessions and lets the user restore
 * or permanently delete them. Backed by GET /api/sessions?archived=1 and the
 * per-session archive route (DELETE to restore, DELETE /api/sessions/[id] to
 * remove forever). Restore is reversible; permanent delete uses an inline
 * two-step confirm so no modal is needed.
 */
import { useCallback, useEffect, useState } from "react";
import { SettingsPageHeading, SettingsGroup, SettingsRow } from "./settings-ui";
import { apiFetch } from "@/lib/api-transport";
import { useLocale } from "@/hooks/useLocale";
import type { SessionInfo } from "@/lib/types";
import { skillExpansionToCommand } from "@/lib/slash-display";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function ArchivedSessionsPanel() {
  const { t } = useLocale();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch("/api/sessions?archived=1&fresh=1");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { sessions: SessionInfo[] };
      // Newest archive first; fall back to modified time when archivedAt is missing.
      setSessions(
        [...data.sessions].sort((a, b) => {
          const ta = a.archivedAt ?? a.modified;
          const tb = b.archivedAt ?? b.modified;
          return tb < ta ? -1 : tb > ta ? 1 : 0;
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSessions([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const removeRow = useCallback((id: string) => {
    setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
  }, []);

  const markBusy = useCallback((id: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const handleRestore = useCallback(async (id: string) => {
    markBusy(id, true);
    try {
      const res = await apiFetch(`/api/sessions/${encodeURIComponent(id)}/archive`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      removeRow(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      markBusy(id, false);
    }
  }, [markBusy, removeRow]);

  const handleDelete = useCallback(async (id: string) => {
    markBusy(id, true);
    try {
      const res = await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      removeRow(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      markBusy(id, false);
      setConfirmId(null);
    }
  }, [markBusy, removeRow]);

  return (
    <div className="settings-page-general">
      <SettingsPageHeading title={t("settings.archived")} description={t("settings.archivedDesc")} />
      {error && (
        <div style={{ marginBottom: 12, fontSize: 12, color: "var(--destructive)", lineHeight: 1.4 }}>
          {error}
        </div>
      )}
      <SettingsGroup>
        {sessions === null ? (
          <div className="settings-card-empty">{t("common.loading")}</div>
        ) : sessions.length === 0 ? (
          <div className="settings-card-empty">{t("settings.archivedEmpty")}</div>
        ) : (
          sessions.map((s) => {
            const title = skillExpansionToCommand(s.name || s.firstMessage || "") || s.firstMessage || s.id.slice(0, 12);
            const archivedLabel = s.archivedAt
              ? t("settings.archivedOn", { date: formatDate(s.archivedAt) })
              : formatDate(s.modified);
            const isBusy = busy.has(s.id);
            const isConfirm = confirmId === s.id;
            return (
              <SettingsRow
                key={s.id}
                title={
                  <>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {title}
                    </span>
                    <span
                      style={{
                        flexShrink: 0,
                        maxWidth: 380,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 11,
                        fontWeight: 400,
                        color: "var(--text-dim)",
                      }}
                      title={s.cwd}
                    >
                      {t("settings.archivedMessages", { count: s.messageCount })} · {s.cwd} · {archivedLabel}
                    </span>
                  </>
                }
                action={
                  isConfirm ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn-ghost btn-compact"
                        disabled={isBusy}
                        onClick={() => setConfirmId(null)}
                      >
                        {t("common.cancel")}
                      </button>
                      <button
                        className="btn-danger btn-compact"
                        disabled={isBusy}
                        onClick={() => void handleDelete(s.id)}
                      >
                        {isBusy ? t("common.deleting") : t("settings.archivedDeleteConfirm")}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn-ghost btn-compact"
                        disabled={isBusy}
                        onClick={() => void handleRestore(s.id)}
                      >
                        {isBusy ? "…" : t("common.restore")}
                      </button>
                      <button
                        className="btn-danger btn-compact"
                        disabled={isBusy}
                        onClick={() => setConfirmId(s.id)}
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  )
                }
              />
            );
          })
        )}
      </SettingsGroup>
    </div>
  );
}
