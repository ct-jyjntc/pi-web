"use client";

import { useLocale } from "@/hooks/useLocale";

import { useState, useEffect, useCallback, useRef } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type {
  SkillInfo as Skill,
  SkillInstallScope,
  SkillSearchResult,
  SkillUpdateResult,
} from "@/lib/api-types";
import { MarkdownBody } from "./MarkdownBody";

function shortenPath(p: string): string {
  // Match common home dir patterns: /Users/xxx, /home/xxx
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function sourceLabel(skill: Skill): string {
  const src = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (scope === "user" || src === "user") return "global";
  if (scope === "project" || src === "project") return "project";
  return "path";
}

function updateKey(skill: Skill): string | null {
  return skill.install
    ? `${skill.install.scope}\0${skill.install.package}`
    : null;
}

function shortVersion(version?: string): string {
  return version ? version.slice(0, 8) : "unknown";
}

function Toggle({
  enabled,
  loading,
  onToggle,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={loading}
      title={
        enabled
          ? t("skills.visibleToModel")
          : t("skills.hiddenFromModel")
      }
      style={{
        flexShrink: 0,
        width: 34,
        height: 18,
        borderRadius: "var(--radius-pill)",
        border: "1px solid var(--border)",
        padding: 0,
        cursor: loading ? "wait" : "pointer",
        // Quiet monochrome switch — filled only when on, no loud accent pill
        background: enabled ? "var(--text)" : "var(--bg-subtle)",
        position: "relative",
        transition: "background 0.15s ease",
        outline: "none",
        opacity: loading ? 0.6 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 1,
          left: enabled ? 17 : 1,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: enabled ? "var(--bg)" : "var(--text-muted)",
          transition: "left 0.15s ease, background 0.15s ease",
        }}
      />
    </button>
  );
}

function SkillDetail({
  skill,
  cwd,
  onToggle,
  toggling,
  saveError,
  updateStatus,
  checkingUpdate,
  updating,
  updateError,
  onCheckUpdate,
  onUpdate,
}: {
  skill: Skill;
  cwd: string;
  onToggle: (skill: Skill) => void;
  toggling: boolean;
  saveError: string | null;
  updateStatus?: SkillUpdateResult;
  checkingUpdate: boolean;
  updating: boolean;
  updateError: string | null;
  onCheckUpdate: () => void;
  onUpdate: () => void;
}) {
  const { t } = useLocale();
  const label = sourceLabel(skill);
  const enabled = !skill.disableModelInvocation;
  const [skillBody, setSkillBody] = useState<string | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSkillBody(null);
    setBodyError(null);
    setBodyLoading(true);
    fetch(`/api/skills/content?path=${encodeURIComponent(skill.filePath)}`)
      .then(async (res) => {
        const data = await res.json() as { body?: string; error?: string };
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (!cancelled) setSkillBody(data.body ?? "");
      })
      .catch((error) => {
        if (!cancelled) setBodyError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setBodyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skill.filePath]);

  function displayPath(p: string): string {
    if (label === "project" && p.startsWith(cwd)) {
      const rel = p.slice(cwd.length).replace(/^[/\\]/, "");
      return `./${rel}`;
    }
    return shortenPath(p);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0, height: "100%" }}>
      {/* Path + tag + toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            fontSize: 10,
            padding: "1px 5px",
            borderRadius: "var(--radius-xs)",
            flexShrink: 0,
            background:
              label === "project"
                ? "color-mix(in oklab, var(--accent) 10%, transparent)"
                : "var(--bg-subtle)",
            color:
              label === "project" ? "var(--accent)" : "var(--text-dim)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-dim)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayPath(skill.filePath)}
        </span>
        <Toggle
          enabled={enabled}
          loading={toggling}
          onToggle={() => onToggle(skill)}
        />
        {saveError && (
          <span style={{ fontSize: 12, color: "var(--destructive)", flexShrink: 0 }}>
            {saveError}
          </span>
        )}
      </div>

      {skill.install?.skillsShUrl && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span
            style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}
          >
            {t("skills.source")}
          </span>
          <a
            href={skill.install.skillsShUrl}
            target="_blank"
            rel="noreferrer"
            title={skill.install.skillsShUrl}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "fit-content",
              maxWidth: "100%",
              color: "var(--accent)",
              textDecoration: "none",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {skill.install.skillsShUrl.replace(/^https?:\/\//, "")} ↗
            </span>
          </a>
        </div>
      )}

      {skill.install && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span
            style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}
          >
            {t("skills.version")}
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              {shortVersion(updateStatus?.currentVersion ?? skill.install.versionHash)}
            </span>
            {skill.install.canCheckForUpdates && (
              <button
                onClick={onCheckUpdate}
                disabled={checkingUpdate || updating}
                style={{
                  padding: "4px 9px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  background: "none",
                  color: "var(--text-muted)",
                  cursor: checkingUpdate || updating ? "not-allowed" : "pointer",
                  opacity: checkingUpdate || updating ? 0.5 : 1,
                  fontSize: 11,
                }}
              >
                Check
              </button>
            )}
            {updateStatus?.state === "update-available" && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--text)",
                }}
              >
                {shortVersion(updateStatus.latestVersion)}
              </span>
            )}
            {(checkingUpdate ||
              (updateStatus && updateStatus.state !== "update-available")) && (
              <span
                style={{
                  fontSize: 12,
                  color: checkingUpdate
                    ? "var(--accent)"
                    : updateStatus?.state === "up-to-date"
                      ? "var(--success)"
                      : updateStatus?.state === "error"
                          ? "var(--destructive)"
                          : "var(--text-dim)",
                }}
              >
                {checkingUpdate
                  ? t("skills.checking")
                  : updateStatus?.state === "up-to-date"
                    ? t("skills.upToDate")
                    : updateStatus?.state === "unsupported"
                        ? t("skills.autoCheckUnavailable")
                        : updateStatus?.message || t("skills.checkFailed")}
              </span>
            )}
            {updateStatus?.state === "update-available" && (
              <button
                onClick={onUpdate}
                disabled={updating || checkingUpdate}
                style={{
                  padding: "4px 10px",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--accent)",
                  color: "var(--accent-fg)",
                  cursor: updating || checkingUpdate ? "not-allowed" : "pointer",
                  opacity: updating || checkingUpdate ? 0.5 : 1,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {updating ? t("modal.updating") : t("modal.update")}
              </button>
            )}
          </div>
          {updateError && (
            <span style={{ fontSize: 12, color: "var(--destructive)" }}>{updateError}</span>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span
          style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}
        >
          {t("shell.name")}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 14,
            color: "var(--text)",
          }}
        >
          {skill.name}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span
          style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}
        >
          {t("skills.description")}
        </span>
        <span
          style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55 }}
        >
          {skill.description}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flex: 1,
          minHeight: 0,
          borderTop: "1px solid var(--border)",
          paddingTop: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
            {t("skills.skillMd")}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-dim)",
            }}
          >
            SKILL.md
          </span>
        </div>
        {bodyLoading && (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("common.loading")}</div>
        )}
        {bodyError && (
          <div style={{ fontSize: 12, color: "var(--destructive)", lineHeight: 1.45 }}>{bodyError}</div>
        )}
        {!bodyLoading && !bodyError && skillBody !== null && (
          skillBody.trim()
            ? (
              <div
                className="settings-skill-body"
                style={{
                  flex: 1,
                  minHeight: 120,
                  overflow: "auto",
                  border: "1px solid var(--border)",
                  background: "var(--bg-panel)",
                  padding: "12px 14px",
                }}
              >
                <MarkdownBody>{skillBody}</MarkdownBody>
              </div>
            )
            : (
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("skills.skillMdEmpty")}</div>
            )
        )}
      </div>
    </div>
  );
}

function AddSkillPanel({
  cwd,
  installedPackages,
  onInstalled,
}: {
  cwd: string;
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
      const res = await fetch("/api/skills/search", {
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
  }, []);

  const install = useCallback(
    async (pkg: string) => {
      setInstalling(pkg);
      setInstallError(null);
      try {
        const res = await fetch("/api/skills/install", {
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── Header area ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
          {t("skills.addSkill")}
        </div>

        {/* Search row */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") search(query);
            }}
            placeholder={t("skills.searchPlaceholder")}
            style={{
              flex: 1,
              padding: "7px 10px",
              fontSize: 13,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text)",
              outline: "none",
            }}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={() => search(query)}
            disabled={searching || !query.trim()}
          >
            {searching ? t("modal.searching") : t("modal.search")}
          </button>
        </div>

        {/* Scope + install path row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              display: "flex",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              overflow: "hidden",
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            {(["global", "project"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                style={{
                  padding: "3px 10px",
                  border: "none",
                  cursor: "pointer",
                  background: scope === s ? "var(--bg-selected)" : "none",
                  color: scope === s ? "var(--text)" : "var(--text-dim)",
                  fontWeight: scope === s ? 600 : 400,
                  borderRight:
                    s === "global" ? "1px solid var(--border)" : "none",
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            → {installPath}
          </span>
        </div>

        {/* Errors */}
        {searchError && (
          <div style={{ fontSize: 12, color: "var(--destructive)" }}>{searchError}</div>
        )}
        {installError && (
          <div
            style={{ fontSize: 12, color: "var(--destructive)", wordBreak: "break-word" }}
          >
            {installError}
          </div>
        )}
      </div>

      {/* ── Results list ── */}
      {results.length > 0 ? (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {results.map((r) => {
            const isInstalled =
              installedPackages[scope].has(r.package) ||
              newlyInstalledPkgs.has(`${scope}:${r.package}`);
            const isInstalling = installing === r.package;
            // split "owner/repo@skill" for cleaner display
            const atIdx = r.package.indexOf("@");
            const repopart = atIdx > -1 ? r.package.slice(0, atIdx) : r.package;
            const skillpart = atIdx > -1 ? r.package.slice(atIdx + 1) : null;
            return (
              <div
                key={r.package}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* skill name prominent */}
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text)",
                      marginBottom: 3,
                    }}
                  >
                    {skillpart ?? repopart}
                  </div>
                  {/* repo + installs + link row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--text-dim)",
                      }}
                    >
                      {repopart}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        fontWeight: 500,
                      }}
                    >
                      {r.installs}
                    </span>
                    {r.url && (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: 12,
                          color: "var(--accent)",
                          textDecoration: "none",
                        }}
                      >
                        skills.sh ↗
                      </a>
                    )}
                  </div>
                </div>
                <button
                  onClick={() =>
                    !isInstalled && !isInstalling && install(r.package)
                  }
                  disabled={isInstalled || isInstalling || installing !== null}
                  style={{
                    flexShrink: 0,
                    padding: "5px 14px",
                    fontSize: 12,
                    fontWeight: 500,
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    cursor:
                      isInstalled || isInstalling || installing !== null
                        ? "not-allowed"
                        : "pointer",
                    background: isInstalled ? "var(--success-bg)" : "none",
                    color: isInstalled
                      ? "var(--success)"
                      : isInstalling
                        ? "var(--accent)"
                        : "var(--text-muted)",
                    transition: "color 0.12s",
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
          <div
            style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.8 }}
          >
            {t("skills.searchEmpty")}
          </div>
        )
      )}
    </div>
  );
}

export function SkillsConfig({
  cwd,
  onClose,
  embedded = false,
}: {
  cwd: string;
  onClose: () => void;
  /** When true, render as a full-height settings page panel (no modal chrome). */
  embedded?: boolean;
}) {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, SkillUpdateResult>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [updatingSkill, setUpdatingSkill] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`);
      const d = (await res.json()) as { skills?: Skill[]; error?: string };
      if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
      const list = d.skills ?? [];
      setSkills(list);
      if (list.length > 0 && !selected) setSelected(list[0].filePath);
      return list;
    } catch (e) {
      setError(String(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, [cwd, selected]);

  useEffect(() => {
    setUpdateStatuses({});
    setUpdateError(null);
    void loadSkills();
  }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkForUpdates = useCallback(async (skill?: Skill) => {
    const targets = skill
      ? [skill]
      : skills.filter((item) => Boolean(item.install));
    const keys = targets
      .map(updateKey)
      .filter((key): key is string => Boolean(key));
    if (keys.length === 0) return;

    setUpdateError(null);
    setCheckingUpdates((current) => new Set([...current, ...keys]));
    if (!skill) setCheckingAll(true);
    try {
      const res = await fetch("/api/skills/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill?.install?.package,
          scope: skill?.install?.scope,
        }),
      });
      const data = (await res.json()) as {
        updates?: SkillUpdateResult[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUpdateStatuses((current) => {
        const next = { ...current };
        for (const update of data.updates ?? []) {
          next[`${update.scope}\0${update.package}`] = update;
        }
        return next;
      });
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingUpdates((current) => {
        const next = new Set(current);
        for (const key of keys) next.delete(key);
        return next;
      });
      if (!skill) setCheckingAll(false);
    }
  }, [cwd, skills]);

  const updateInstalledSkill = useCallback(async (skill: Skill) => {
    if (!skill.install) return;
    const key = updateKey(skill)!;
    setUpdatingSkill(key);
    setUpdateError(null);
    try {
      const res = await fetch("/api/skills/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill.install.package,
          scope: skill.install.scope,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        skill?: Skill;
        error?: string;
      };
      if (!res.ok || data.error || !data.success) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await loadSkills();
      const versionHash = data.skill?.install?.versionHash;
      setUpdateStatuses((current) => ({
        ...current,
        [key]: {
          package: skill.install!.package,
          scope: skill.install!.scope,
          state: "up-to-date",
          currentVersion: versionHash,
          latestVersion: versionHash,
        },
      }));
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdatingSkill(null);
    }
  }, [cwd, loadSkills]);

  const toggle = useCallback(async (skill: Skill) => {
    const next = !skill.disableModelInvocation;
    setToggling((s) => new Set(s).add(skill.filePath));
    setSaveError(null);
    try {
      const res = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: skill.filePath,
          disableModelInvocation: next,
        }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setSaveError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setSkills((prev) =>
        prev.map((s) =>
          s.filePath === skill.filePath
            ? { ...s, disableModelInvocation: next }
            : s,
        ),
      );
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setToggling((s) => {
        const n = new Set(s);
        n.delete(skill.filePath);
        return n;
      });
    }
  }, []);

  const selectedSkill = skills.find((s) => s.filePath === selected) ?? null;

  const panel = (
      <div
        className={embedded ? "settings-embedded" : "modal-shell"}
        role={embedded ? undefined : "dialog"}
        aria-modal={embedded ? undefined : true}
        style={embedded ? {
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          width: "100%",
          background: "var(--bg)",
        } : {
          width: isMobile ? "calc(100vw - 16px)" : 860,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "78vh",
          maxHeight: "calc(100dvh - 16px)",
        }}
      >
        {/* Header — strip chrome */}
        <div className="modal-header" style={embedded ? { borderRadius: 0 } : undefined}>
          <div className="modal-header-meta">
            <span className="modal-title">{t("modal.skills")}</span>
            <code className="modal-subtitle">{shortenPath(cwd)}</code>
          </div>
          {!embedded && (
            <button
              type="button"
              className="chrome-btn is-icon"
              onClick={onClose}
              aria-label={t("common.close")}
            >
              ×
            </button>
          )}
        </div>

        {/* Body */}
        <div className="modal-body" style={{ flexDirection: isMobile ? "column" : "row", flex: 1, minHeight: 0 }}>
          {/* Left: skill list */}
          <div className="modal-sidebar" style={isMobile ? { width: "100%", maxHeight: "40vh" } : undefined}>
            <div className="modal-sidebar-scroll">
              {loading ? (
                <div
                  style={{
                    padding: "10px 8px",
                    fontSize: 12,
                    color: "var(--text-muted)",
                  }}
                >
                  {t("modal.loading")}
                </div>
              ) : error ? (
                <div
                  style={{
                    padding: "10px 8px",
                    fontSize: 11,
                    color: "var(--destructive)",
                  }}
                >
                  {error}
                </div>
              ) : skills.length === 0 ? (
                <div
                  style={{
                    padding: "10px 8px",
                    fontSize: 11,
                    color: "var(--text-dim)",
                  }}
                >
                  {t("skills.noSkills")}
                </div>
              ) : (
                (() => {
                  const groups: { label: string; skills: typeof skills }[] = [];
                  const groupDefinitions = [
                    {
                      label: t("skills.groupProject"),
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "project" &&
                        Boolean(skill.install?.skillsShUrl),
                    },
                    {
                      label: "project",
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "project" &&
                        !skill.install?.skillsShUrl,
                    },
                    {
                      label: t("skills.groupGlobal"),
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "global" &&
                        Boolean(skill.install?.skillsShUrl),
                    },
                    {
                      label: t("skills.groupGlobal"),
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "global" &&
                        !skill.install?.skillsShUrl,
                    },
                    {
                      label: t("skills.groupPath"),
                      matches: (skill: Skill) => sourceLabel(skill) === "path",
                    },
                  ];
                  for (const { label, matches } of groupDefinitions) {
                    const grpSkills = skills.filter(matches);
                    if (grpSkills.length > 0)
                      groups.push({ label, skills: grpSkills });
                  }
                  return groups.map(
                    ({ label: grpLabel, skills: grpSkills }) => (
                      <div key={grpLabel}>
                        <div className="modal-group-label">{grpLabel}</div>
                        {grpSkills.map((skill) => {
                          const isSelected =
                            !addMode && selected === skill.filePath;
                          const disabled = skill.disableModelInvocation;
                          return (
                            <div
                              key={skill.filePath}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setSelected(skill.filePath);
                                setAddMode(false);
                              }}
                              className={`modal-nav-item${isSelected ? " is-active" : ""}`}
                            >
                              <span
                                style={{
                                  flexShrink: 0,
                                  width: 6,
                                  height: 6,
                                  borderRadius: "50%",
                                  background: disabled
                                    ? "var(--border)"
                                    : "var(--text)",
                                  opacity: disabled ? 1 : 0.75,
                                }}
                              />
                              <span
                                className={`modal-nav-label is-mono${isSelected ? " is-strong" : ""}`}
                                style={{
                                  color: disabled
                                    ? "var(--text-dim)"
                                    : undefined,
                                }}
                              >
                                {skill.name}
                              </span>
                              {(() => {
                                const key = updateKey(skill);
                                const status = key ? updateStatuses[key] : undefined;
                                if (status?.state !== "update-available") return null;
                                return (
                                  <span
                                    title={t("skills.updateAvailable")}
                                    style={{
                                      color: "var(--text)",
                                      fontSize: 13,
                                      lineHeight: 1,
                                      flexShrink: 0,
                                    }}
                                  >
                                    ↑
                                  </span>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>
                    ),
                  );
                })()
              )}
            </div>
            {/* Add skill — strip footer action */}
            <div className="modal-sidebar-footer">
              <button
                type="button"
                className={`chrome-btn${addMode ? " is-active" : ""}`}
                onClick={() => setAddMode(true)}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t("skills.addSkill")}
              </button>
            </div>
          </div>

          {/* Right: detail or add panel */}
          <div className="modal-main" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            {addMode ? (
              <AddSkillPanel
                cwd={cwd}
                installedPackages={{
                  global: new Set(
                    skills
                      .filter((skill) => skill.install?.scope === "global")
                      .map((skill) => skill.install!.package),
                  ),
                  project: new Set(
                    skills
                      .filter((skill) => skill.install?.scope === "project")
                      .map((skill) => skill.install!.package),
                  ),
                }}
                onInstalled={() => {
                  void loadSkills();
                }}
              />
            ) : loading ? null : selectedSkill ? (
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <SkillDetail
                key={selectedSkill.filePath}
                skill={selectedSkill}
                cwd={cwd}
                onToggle={toggle}
                toggling={toggling.has(selectedSkill.filePath)}
                saveError={saveError}
                updateStatus={
                  updateKey(selectedSkill)
                    ? updateStatuses[updateKey(selectedSkill)!]
                    : undefined
                }
                checkingUpdate={
                  updateKey(selectedSkill)
                    ? checkingUpdates.has(updateKey(selectedSkill)!)
                    : false
                }
                updating={updatingSkill === updateKey(selectedSkill)}
                updateError={updateError}
                onCheckUpdate={() => void checkForUpdates(selectedSkill)}
                onUpdate={() => void updateInstalledSkill(selectedSkill)}
              />
              </div>
            ) : (
              <div className="modal-empty">{t("skills.selectSkill")}</div>
            )}
          </div>
        </div>

        {/* Footer — strip chrome */}
        <div className="modal-footer" style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {skills.some((skill) => Boolean(skill.install)) && (
              <button
                type="button"
                className="chrome-btn"
                onClick={() => void checkForUpdates()}
                disabled={checkingAll || updatingSkill !== null}
              >
                {checkingAll ? t("skills.checking") : t("skills.checkUpdates")}
              </button>
            )}
            {Object.values(updateStatuses).filter(
              (status) => status.state === "update-available",
            ).length > 0 && (
              <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                {
                  Object.values(updateStatuses).filter(
                    (status) => status.state === "update-available",
                  ).length
                }{" "}
                {Object.values(updateStatuses).filter(
                  (status) => status.state === "update-available",
                ).length === 1
                  ? "update"
                  : "updates"}
              </span>
            )}
          </div>
          {!embedded && (
            <button type="button" className="chrome-btn" onClick={onClose}>
              {t("common.close")}
            </button>
          )}
        </div>
      </div>
  );

  if (embedded) return panel;
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {panel}
    </div>
  );
}
