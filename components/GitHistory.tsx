"use client";

/**
 * Collapsible commit history docked under the working-tree list. Secondary
 * to Changes: collapsed by default, lazy-loaded, and visually a footer
 * section rather than a mid-panel insert.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-transport";
import { useLocale } from "@/hooks/useLocale";
import { DiffView } from "./DiffView";
import { Icon } from "./Icon";
import { ChevronRight, GitCommitHorizontal, History } from "lucide-react";

type GitCommitSummary = {
  sha: string;
  shortSha: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  fileCount: number;
  insertions: number;
  deletions: number;
};

type GitCommitFile = {
  path: string;
  originalPath: string | null;
  status: string;
  insertions: number;
  deletions: number;
};

type GitCommitDetail = {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
  files: GitCommitFile[];
};

const LOG_LIMIT = 50;

export function GitHistory({
  cwd,
  historyKey,
}: {
  cwd: string;
  /** Bumped by GitPanel after commit/split/merge so the list reloads. */
  historyKey: number;
}) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [commits, setCommits] = useState<GitCommitSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, GitCommitDetail>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  /** `${sha}:${path}` → patch state */
  const [diffStates, setDiffStates] = useState<Record<string, { loading?: boolean; patch?: string | null; error?: string }>>({});

  // Load lazily: only fetch history when the section is opened, and reload
  // when the panel says a git write happened while it was open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ cwd, limit: String(LOG_LIMIT) });
    apiFetch(`/api/git/log?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json() as { commits?: GitCommitSummary[]; error?: string };
        if (cancelled) return;
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        setCommits(data.commits ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, open, historyKey]);

  const toggleCommit = useCallback(async (sha: string) => {
    if (expanded === sha) {
      setExpanded(null);
      return;
    }
    setExpanded(sha);
    if (details[sha]) return;
    setDetailLoading(true);
    try {
      const params = new URLSearchParams({ cwd, sha });
      const res = await apiFetch(`/api/git/commit?${params.toString()}`);
      const data = await res.json() as { commit?: GitCommitDetail; error?: string };
      if (!res.ok || data.error || !data.commit) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setDetails((prev) => ({ ...prev, [sha]: data.commit! }));
    } catch (e) {
      setDetails((prev) => ({
        ...prev,
        [sha]: {
          sha,
          parents: [],
          authorName: "",
          authorEmail: "",
          authorDate: "",
          subject: "",
          files: [],
        } as GitCommitDetail,
      }));
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }, [cwd, details, expanded]);

  const diffStatesRef = useRef<Record<string, { loading?: boolean; patch?: string | null; error?: string }>>({});
  diffStatesRef.current = diffStates;

  const toggleFileDiff = useCallback((sha: string, path: string) => {
    const key = `${sha}:${path}`;
    const current = diffStatesRef.current[key];
    // Expanded already (has a patch or an error) → collapse.
    if (current?.patch !== undefined || current?.error) {
      setDiffStates((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setDiffStates((prev) => ({ ...prev, [key]: { loading: true } }));
    const params = new URLSearchParams({ cwd, sha, path });
    apiFetch(`/api/git/commit-diff?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json() as { patch?: string; error?: string };
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        setDiffStates((inner) => ({ ...inner, [key]: { patch: data.patch ?? null } }));
      })
      .catch((e) => {
        setDiffStates((inner) => ({ ...inner, [key]: { error: e instanceof Error ? e.message : String(e) } }));
      });
  }, [cwd]);

  return (
    <section className={`git-history${open ? " is-open" : ""}`} aria-label={t("git.history")}>
      <header className="git-history-header">
        <button
          type="button"
          className="git-history-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <Icon
            icon={ChevronRight}
            size={10}
            strokeWidth={1.8}
            className={`git-history-chevron${open ? " is-open" : ""}`}
          />
          <Icon icon={History} size={12} className="git-history-icon" />
          <span className="git-history-title">{t("git.history")}</span>
        </button>
        {open && commits && commits.length > 0 && !loading && (
          <span className="git-history-count">{commits.length}</span>
        )}
      </header>

      {open && (
        <div className="git-history-list">
          {loading && !commits && (
            <div className="git-history-status">{t("git.historyLoading")}</div>
          )}
          {error && !commits && (
            <div className="git-history-status is-error">{error}</div>
          )}
          {!loading && !error && commits && commits.length === 0 && (
            <div className="git-history-status">{t("git.historyEmpty")}</div>
          )}
          {commits?.map((commit) => {
            const isExpanded = expanded === commit.sha;
            const detail = details[commit.sha];
            return (
              <div key={commit.sha} className={`git-history-commit${isExpanded ? " is-open" : ""}`}>
                <button
                  type="button"
                  className="git-history-commit-row"
                  onClick={() => void toggleCommit(commit.sha)}
                  aria-expanded={isExpanded}
                >
                  <Icon
                    icon={ChevronRight}
                    size={9}
                    strokeWidth={1.6}
                    className={`git-history-chevron is-nested${isExpanded ? " is-open" : ""}`}
                  />
                  <Icon icon={GitCommitHorizontal} size={12} className="git-history-commit-mark" />
                  <span className="git-history-subject" title={commit.subject}>{commit.subject}</span>
                  <span className="git-history-sha">{commit.shortSha}</span>
                  {(commit.insertions > 0 || commit.deletions > 0) && (
                    <span className="git-history-stat">
                      {commit.insertions > 0 && <span className="is-add">+{commit.insertions}</span>}
                      {commit.deletions > 0 && <span className="is-del">-{commit.deletions}</span>}
                    </span>
                  )}
                </button>

                {isExpanded && (
                  <div className="git-history-detail">
                    <div className="git-history-meta">
                      {formatRelative(commit.authorDate, locale)} · {commit.authorName}
                      {commit.fileCount > 0 && (
                        <span> · {t("git.commitFiles", { n: commit.fileCount })}</span>
                      )}
                    </div>
                    {detailLoading && !detail && (
                      <div className="git-history-status">{t("git.historyLoading")}</div>
                    )}
                    {detail && detail.files.length === 0 && (
                      <div className="git-history-status">{t("git.noCommitDiff")}</div>
                    )}
                    {detail?.files.map((file) => {
                      const key = `${commit.sha}:${file.path}`;
                      const state = diffStates[key];
                      const isDiffOpen = state !== undefined;
                      return (
                        <div key={file.path} className="git-history-file">
                          <button
                            type="button"
                            className="git-history-file-row"
                            onClick={() => toggleFileDiff(commit.sha, file.path)}
                            aria-expanded={isDiffOpen}
                          >
                            <span
                              className="git-file-code"
                              style={{ color: statusColor(file.status) }}
                            >
                              {statusLetter(file.status)}
                            </span>
                            <span
                              className="git-history-file-name"
                              title={file.originalPath && file.originalPath !== file.path
                                ? `${file.originalPath} → ${file.path}`
                                : file.path}
                            >
                              {file.path}
                            </span>
                            {(file.insertions > 0 || file.deletions > 0) && (
                              <span className="git-history-stat">
                                {file.insertions > 0 && <span className="is-add">+{file.insertions}</span>}
                                {file.deletions > 0 && <span className="is-del">-{file.deletions}</span>}
                              </span>
                            )}
                          </button>
                          {isDiffOpen && (
                            <div className="git-history-file-diff">
                              {state?.loading && (
                                <div className="git-history-status">{t("git.historyLoading")}</div>
                              )}
                              {state?.error && (
                                <div className="git-history-status is-error">{state.error}</div>
                              )}
                              {state?.patch !== undefined && (
                                state.patch
                                  ? <DiffView patch={state.patch} />
                                  : <div className="git-history-status">{t("git.noCommitDiff")}</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function statusLetter(status: string): string {
  if (status.startsWith("R")) return "R";
  if (status.startsWith("C")) return "C";
  return status.slice(0, 1) || "M";
}

function statusColor(status: string): string {
  const letter = statusLetter(status);
  if (letter === "A") return "var(--success)";
  if (letter === "D") return "var(--destructive)";
  if (letter === "R" || letter === "C") return "var(--text-muted)";
  return "var(--text)";
}

function formatRelative(iso: string, locale: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  // Intl.RelativeTimeFormat expects the value expressed in the chosen unit —
  // passing raw seconds would print the second count as "days ago".
  const abs = Math.abs(seconds);
  const [value, unit] = abs < 60
    ? [seconds, "second"]
    : abs < 3600
      ? [Math.round(seconds / 60), "minute"]
      : abs < 86400
        ? [Math.round(seconds / 3600), "hour"]
        : abs < 604800
          ? [Math.round(seconds / 86400), "day"]
          : [Math.round(seconds / 604800), "week"];
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
      value,
      unit as Intl.RelativeTimeFormatUnit,
    );
  } catch {
    return iso;
  }
}
