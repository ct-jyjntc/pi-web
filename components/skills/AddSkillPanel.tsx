/**
 * Discover and install skills from skills.sh into global or project scope.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocale } from "@/hooks/useLocale";
import { apiFetch } from "@/lib/api-transport";
import type { SkillInstallScope, SkillSearchResult } from "@/lib/api-types";
import { shortenPath } from "./skill-helpers";

export function AddSkillPanel({
  cwd,
  onBack,
  installedPackages,
  onInstalled,
}: {
  cwd: string;
  onBack: () => void;
  installedPackages: Record<SkillInstallScope, ReadonlySet<string>>;
  onInstalled: () => void;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [newlyInstalledPkgs, setNewlyInstalledPkgs] = useState<Set<string>>(
    new Set(),
  );
  const [scope, setScope] = useState<"global" | "project">("global");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setSearchError(null);
    setResults([]);
    try {
      const res = await apiFetch("/api/skills/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim() }),
      });
      const d = (await res.json()) as {
        results?: SkillSearchResult[];
        error?: string;
      };
      if (d.error) {
        setSearchError(d.error);
        return;
      }
      setResults(d.results ?? []);
      if ((d.results ?? []).length === 0) setSearchError(t("skills.noSkills"));
    } catch (e) {
      setSearchError(String(e));
    } finally {
      setSearching(false);
    }
  }, [t]);

  const install = useCallback(
    async (pkg: string) => {
      setInstalling(pkg);
      setInstallError(null);
      try {
        const res = await apiFetch("/api/skills/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ package: pkg, scope, cwd }),
        });
        const d = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok || d.error) {
          setInstallError(d.error ?? `HTTP ${res.status}`);
          return;
        }
        setNewlyInstalledPkgs((prev) =>
          new Set(prev).add(`${scope}:${pkg}`),
        );
        onInstalled();
      } catch (e) {
        setInstallError(String(e));
      } finally {
        setInstalling(null);
      }
    },
    [onInstalled, scope, cwd],
  );

  const installPath =
    scope === "global"
      ? "~/.pi/agent/skills/"
      : `${shortenPath(cwd)}/.pi/skills/`;

  return (
    <div className="skill-add-panel">
      <div className="skill-add-header">
        <div className="skill-catalog-toolbar">
          <label className="skill-catalog-search">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void search(query);
              }}
              placeholder={t("skills.searchPlaceholder")}
              className="input-base"
            />
          </label>
          <button
            type="button"
            className="btn-primary btn-compact"
            onClick={() => void search(query)}
            disabled={searching || !query.trim()}
          >
            {searching ? t("modal.searching") : t("modal.search")}
          </button>
          <button
            type="button"
            className="btn-ghost btn-compact"
            onClick={onBack}
          >
            {t("skills.back")}
          </button>
        </div>
        <div className="skill-add-scope">
          <div className="settings-segmented">
            {(["global", "project"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`chrome-btn${scope === s ? " is-active" : ""}`}
                aria-pressed={scope === s}
                onClick={() => setScope(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <span className="skill-add-path">→ {installPath}</span>
        </div>
        {searchError && <div className="skill-add-error">{searchError}</div>}
        {installError && <div className="skill-add-error">{installError}</div>}
      </div>

      {results.length > 0 ? (
        <div className="skill-add-results">
          {results.map((r) => {
            const isInstalled =
              installedPackages[scope].has(r.package) ||
              newlyInstalledPkgs.has(`${scope}:${r.package}`);
            const isInstalling = installing === r.package;
            const atIdx = r.package.indexOf("@");
            const repopart = atIdx > -1 ? r.package.slice(0, atIdx) : r.package;
            const skillpart = atIdx > -1 ? r.package.slice(atIdx + 1) : null;
            return (
              <div key={r.package} className="skill-add-row">
                <div className="skill-add-row-copy">
                  <div className="skill-add-row-name">{skillpart ?? repopart}</div>
                  <div className="skill-add-row-meta">
                    <span className="skill-add-row-repo">{repopart}</span>
                    <span>{r.installs}</span>
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noreferrer">
                        skills.sh ↗
                      </a>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  onClick={() =>
                    !isInstalled && !isInstalling && void install(r.package)
                  }
                  disabled={isInstalled || isInstalling || installing !== null}
                  style={{
                    flexShrink: 0,
                    background: isInstalled ? "var(--success-bg)" : undefined,
                    color: isInstalled
                      ? "var(--success)"
                      : isInstalling
                        ? "var(--accent)"
                        : undefined,
                  }}
                >
                  {isInstalled
                    ? t("skills.installed")
                    : isInstalling
                      ? t("modal.installing")
                      : t("modal.install")}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        !searchError &&
        !searching && (
          <div className="skill-add-empty">{t("skills.searchEmpty")}</div>
        )
      )}
    </div>
  );
}
