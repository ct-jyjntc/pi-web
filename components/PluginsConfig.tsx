"use client";

import { useLocale } from "@/hooks/useLocale";
import { translate, type MessageKey } from "@/lib/i18n/messages";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { PluginPackageInfo, PluginSearchResult, PluginsResponse } from "@/lib/api-types";

type PluginScope = PluginPackageInfo["scope"];
type PluginAction = "install" | "remove" | "update" | "disable" | "enable";

function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function packageKey(pkg: Pick<PluginPackageInfo, "source" | "scope">): string {
  return `${pkg.scope}\0${pkg.source}`;
}

function tr(key: MessageKey): string {
  const locale = typeof document !== "undefined" && document.documentElement.lang === "zh" ? "zh" : "en";
  return translate(locale, key);
}

function resourceSummary(pkg: PluginPackageInfo): string {
  if (pkg.disabled) return tr("plugins.disabled");
  const parts = [
    pkg.counts.extensions ? `${pkg.counts.extensions} ext` : "",
    pkg.counts.skills ? `${pkg.counts.skills} skills` : "",
    pkg.counts.prompts ? `${pkg.counts.prompts} prompts` : "",
    pkg.counts.themes ? `${pkg.counts.themes} themes` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : tr("plugins.noResources");
}

function versionSummary(pkg: PluginPackageInfo): string {
  const parts = [];
  if (pkg.version) parts.push(`installed ${pkg.version}`);
  if (pkg.configuredVersion) parts.push(`configured ${pkg.configuredVersion}`);
  return parts.length ? parts.join(" · ") : tr("plugins.unknown");
}

function installLocation(scope: PluginScope, cwd: string): string {
  return scope === "project"
    ? `${shortenPath(cwd)}/.pi/agent/{npm,git}`
    : "~/.pi/agent/{npm,git}";
}

function findInstalledPackage(
  packages: PluginPackageInfo[],
  source: string,
  scope: PluginScope,
): PluginPackageInfo | undefined {
  const trimmed = source.trim();
  const withoutNpmPrefix = trimmed.startsWith("npm:") ? trimmed.slice(4) : trimmed;
  return packages.find((pkg) => pkg.scope === scope && pkg.source === trimmed)
    ?? packages.find((pkg) => pkg.scope === scope && pkg.source === `npm:${withoutNpmPrefix}`)
    ?? packages.find((pkg) => pkg.scope === scope && pkg.source.endsWith(trimmed));
}

function statusColor(status: PluginPackageInfo["status"]): string {
  if (status === "loaded") return "var(--accent)";
  if (status === "installed") return "var(--text-muted)";
  if (status === "disabled") return "var(--text-dim)";
  return "var(--destructive)";
}

function ResourceList({ pkg }: { pkg: PluginPackageInfo }) {
  const { t } = useLocale();
  const groups = ([
    ["extension", "Extensions"],
    ["skill", "Skills"],
    ["prompt", "Prompts"],
    ["theme", "Themes"],
  ] as const)
    .map(([kind, label]) => ({
      kind,
      label,
      resources: pkg.resources.filter((resource) => resource.kind === kind),
    }))
    .filter((group) => group.resources.length > 0);

  if (groups.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
        {pkg.disabled ? t("plugins.packageDisabled") : t("plugins.noResolved")}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {groups.map((group, groupIndex) => (
        <div
          key={group.kind}
          style={{
            borderTop: groupIndex === 0 ? "none" : "1px solid var(--border)",
            paddingTop: groupIndex === 0 ? 0 : 12,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--text-dim)",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            {group.label}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {group.resources.map((resource) => (
              <div key={`${resource.kind}:${resource.path}`} style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={resource.path}
                >
                  {resource.name}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-dim)",
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginTop: 1,
                  }}
                  title={resource.path}
                >
                  {resource.relativePath}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScopeTag({ scope }: { scope: PluginScope }) {
  const { t } = useLocale();
  return (
    <span
      style={{
        fontSize: 10,
        padding: "1px 5px",
        borderRadius: 3,
        flexShrink: 0,
        background: scope === "project" ? "rgba(99,102,241,0.12)" : "rgba(120,120,120,0.12)",
        color: scope === "project" ? "rgba(99,102,241,0.85)" : "var(--text-dim)",
      }}
    >
      {scope}
    </span>
  );
}

function buttonStyle(disabled?: boolean, danger?: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    background: danger ? "rgba(239,68,68,0.08)" : "none",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: danger ? "var(--destructive)" : "var(--text-muted)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
    opacity: disabled ? 0.5 : 1,
  };
}

function Toggle({
  enabled,
  loading,
  onToggle,
  label,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
  label: string;
}) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={loading}
      title={label}
      aria-label={label}
      aria-pressed={enabled}
      style={{
        flexShrink: 0,
        width: 40,
        height: 22,
        borderRadius: 11,
        border: "none",
        padding: 0,
        cursor: loading ? "wait" : "pointer",
        background: enabled ? "var(--accent)" : "var(--border)",
        position: "relative",
        transition: "background 0.18s",
        outline: "none",
        opacity: loading ? 0.65 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: enabled ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--bg)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
          transition: "left 0.18s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </button>
  );
}

function SegmentedScope({
  value,
  onChange,
}: {
  value: PluginScope;
  onChange: (scope: PluginScope) => void;
}) {
  const { t } = useLocale();
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--border)",
        borderRadius: 7,
        overflow: "hidden",
        height: 30,
      }}
    >
      {(["global", "project"] as PluginScope[]).map((scope) => {
        const active = value === scope;
        return (
          <button
            key={scope}
            onClick={() => onChange(scope)}
            style={{
              width: 76,
              border: "none",
              borderRight: scope === "global" ? "1px solid var(--border)" : "none",
              background: active ? "var(--bg-selected)" : "none",
              color: active ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {scope}
          </button>
        );
      })}
    </div>
  );
}

function AddPluginPanel({
  cwd,
  source,
  scope,
  busy,
  actionError,
  installedSources,
  onSourceChange,
  onScopeChange,
  onInstall,
  onInstallSource,
}: {
  cwd: string;
  source: string;
  scope: PluginScope;
  busy: boolean;
  actionError: string | null;
  installedSources: ReadonlySet<string>;
  onSourceChange: (value: string) => void;
  onScopeChange: (scope: PluginScope) => void;
  onInstall: () => void;
  onInstallSource: (source: string) => void;
}) {
  const { t } = useLocale();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PluginSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  const search = useCallback(async (q: string) => {
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch("/api/plugins/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim(), limit: 24 }),
      });
      const data = (await res.json()) as {
        results?: PluginSearchResult[];
        total?: number;
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResults(data.results ?? []);
      setTotal(typeof data.total === "number" ? data.total : (data.results ?? []).length);
      setCatalogLoaded(true);
      if ((data.results ?? []).length === 0) setSearchError(t("plugins.noPackages"));
    } catch (err) {
      setResults([]);
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }, [t]);

  useEffect(() => {
    searchRef.current?.focus();
    void search("");
    // Load popular catalog once when the add panel mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isInstalled = (item: PluginSearchResult) =>
    installedSources.has(item.source) || installedSources.has(item.name) || installedSources.has(`npm:${item.name}`);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, gap: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, flexShrink: 0, paddingBottom: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
            {t("plugins.addPlugin")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {t("plugins.catalogHint")}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            {installLocation(scope, cwd)}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <SegmentedScope value={scope} onChange={onScopeChange} />
          <a
            href="https://www.npmjs.com/search?q=keywords%3Api-package"
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "underline" }}
          >
            {t("plugins.browseCatalog")}
          </a>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search(query);
            }}
            placeholder={t("plugins.searchPlaceholder")}
            style={{
              flex: 1,
              height: 36,
              padding: "0 11px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg-panel)",
              color: "var(--text)",
              fontSize: 13,
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={() => void search(query)}
            disabled={searching}
            style={{
              ...buttonStyle(searching),
              background: "var(--accent)",
              color: "var(--accent-fg)",
              borderColor: "var(--accent)",
              minWidth: 88,
            }}
          >
            {searching ? t("modal.searching") : t("modal.search")}
          </button>
        </div>

        {searchError && (
          <div style={{ fontSize: 12, color: "var(--destructive)", whiteSpace: "pre-wrap" }}>
            {searchError}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", borderTop: "1px solid var(--border)" }}>
        {results.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--text-dim)", padding: "8px 0 4px" }}>
            {query.trim() ? `${results.length} / ${total}` : `${t("plugins.popular")} · ${results.length}`}
          </div>
        )}
        {results.map((item) => {
          const installed = isInstalled(item);
          return (
            <div
              key={item.source}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "12px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                    {item.name}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                    v{item.version}
                  </span>
                  {item.publisher && (
                    <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                      @{item.publisher}
                    </span>
                  )}
                </div>
                {item.description && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.45 }}>
                    {item.description}
                  </div>
                )}
                <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 11, color: "var(--text-dim)", textDecoration: "underline" }}
                  >
                    {t("plugins.openNpm")}
                  </a>
                  <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                    {item.source}
                  </span>
                </div>
              </div>
              <button
                type="button"
                disabled={busy || installed}
                onClick={() => onInstallSource(item.source)}
                style={{
                  ...buttonStyle(busy || installed),
                  flexShrink: 0,
                  background: installed ? "var(--bg-panel)" : "var(--accent)",
                  color: installed ? "var(--text-dim)" : "var(--accent-fg)",
                  borderColor: installed ? "var(--border)" : "var(--accent)",
                  minWidth: 72,
                }}
              >
                {installed ? t("plugins.alreadyInstalled") : busy ? t("modal.installing") : t("plugins.installSource")}
              </button>
            </div>
          );
        })}

        {!searching && catalogLoaded && results.length === 0 && !searchError && (
          <div style={{ fontSize: 12, color: "var(--text-dim)", padding: "12px 0" }}>{t("plugins.noPackages")}</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "14px 0 4px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
            {t("plugins.manualSource")}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={source}
              onChange={(e) => onSourceChange(e.target.value)}
              placeholder={t("plugins.packagePlaceholder")}
              style={{
                flex: 1,
                minWidth: 220,
                height: 34,
                padding: "0 11px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg-panel)",
                color: "var(--text)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                outline: "none",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && source.trim() && !busy) onInstall();
              }}
            />
            <button
              type="button"
              onClick={onInstall}
              disabled={busy || !source.trim()}
              style={{
                ...buttonStyle(busy || !source.trim()),
                background: "var(--accent)",
                color: "var(--accent-fg)",
                borderColor: "var(--accent)",
              }}
            >
              {busy ? t("modal.installing") : t("modal.install")}
            </button>
          </div>
        </div>

        {actionError && (
          <div style={{ fontSize: 12, color: "var(--destructive)", whiteSpace: "pre-wrap", paddingBottom: 8 }}>
            {actionError}
          </div>
        )}
      </div>
    </div>
  );
}

function PackageDetail({
  pkg,
  cwd,
  busyKey,
  actionError,
  actionMessage,
  sessionId,
  onAction,
  onReloadSession,
}: {
  pkg: PluginPackageInfo;
  cwd: string;
  busyKey: string | null;
  actionError: string | null;
  actionMessage: string | null;
  sessionId: string | null;
  onAction: (action: PluginAction, pkg: PluginPackageInfo) => void;
  onReloadSession: () => void;
}) {
  const { t } = useLocale();
  const key = packageKey(pkg);
  const busy = busyKey?.endsWith(key) ?? false;
  const reloadBusy = busyKey === "reload";
  const enabled = !pkg.disabled;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 680 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, minWidth: 0, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 180, flex: 1 }}>
          <Toggle
            enabled={enabled}
            loading={busy || reloadBusy}
            onToggle={() => onAction(pkg.disabled ? "enable" : "disable", pkg)}
            label={pkg.disabled ? t("plugins.enable") : t("plugins.disable")}
          />
          <ScopeTag scope={pkg.scope} />
          {pkg.disabled ? (
            <span
              style={{
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 3,
                background: "rgba(120,120,120,0.12)",
                color: "var(--text-dim)",
              }}
            >
              disabled
            </span>
          ) : pkg.filtered && (
            <span
              style={{
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 3,
                background: "rgba(245,158,11,0.12)",
                color: "var(--text)",
              }}
            >
              filtered
            </span>
          )}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {pkg.source}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => onAction("update", pkg)}
            disabled={busy || reloadBusy}
            style={buttonStyle(busy || reloadBusy)}
          >
            {busyKey === `update:${key}` ? t("modal.updating") : t("modal.update")}
          </button>
          <button
            onClick={onReloadSession}
            disabled={!sessionId || reloadBusy || busy}
            style={buttonStyle(!sessionId || reloadBusy || busy)}
            title={sessionId ? t("plugins.reloadCurrent") : t("plugins.openSessionToReload")}
          >
            {reloadBusy ? t("plugins.reloading") : t("plugins.reloadSession")}
          </button>
          <button
            onClick={() => onAction("remove", pkg)}
            disabled={busy || reloadBusy}
            style={buttonStyle(busy || reloadBusy, true)}
          >
            {busyKey === `remove:${key}` ? t("modal.removing") : t("modal.remove")}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(96px, 130px) minmax(0, 1fr)",
          gap: "9px 14px",
          fontSize: 12,
          lineHeight: 1.45,
        }}
      >
        <div style={{ color: "var(--text-dim)" }}>{t("plugins.status")}</div>
        <div style={{ color: statusColor(pkg.status), textTransform: "capitalize" }}>{pkg.status}</div>
        <div style={{ color: "var(--text-dim)" }}>{t("plugins.version")}</div>
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{versionSummary(pkg)}</div>
        <div style={{ color: "var(--text-dim)" }}>{t("plugins.package")}</div>
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
          {pkg.packageName ?? t("plugins.unknown")}
        </div>
        <div style={{ color: "var(--text-dim)" }}>{t("plugins.resources")}</div>
        <div style={{ color: "var(--text-muted)" }}>{resourceSummary(pkg)}</div>
        <div style={{ color: "var(--text-dim)" }}>{t("plugins.installedPath")}</div>
        <div
          style={{
            color: pkg.installedPath ? "var(--text-muted)" : "var(--destructive)",
            fontFamily: "var(--font-mono)",
            overflowWrap: "anywhere",
          }}
        >
          {pkg.installedPath ? shortenPath(pkg.installedPath) : t("plugins.notFound")}
        </div>
        <div style={{ color: "var(--text-dim)" }}>{t("plugins.cwd")}</div>
        <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
          {shortenPath(cwd)}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
          Resolved Resources
        </div>
        <ResourceList pkg={pkg} />
      </div>

      {actionMessage && (
        <div style={{ fontSize: 12, color: "var(--success)" }}>
          {actionMessage}
        </div>
      )}
      {actionError && (
        <div style={{ fontSize: 12, color: "var(--destructive)", whiteSpace: "pre-wrap" }}>
          {actionError}
        </div>
      )}
    </div>
  );
}

export function PluginsConfig({
  cwd,
  sessionId,
  onClose,
  onReloaded,
}: {
  cwd: string;
  sessionId: string | null;
  onClose: () => void;
  onReloaded?: () => void;
}) {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [installScope, setInstallScope] = useState<PluginScope>("global");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const packages = useMemo(() => data?.packages ?? [], [data?.packages]);
  const selectedPackage = packages.find((pkg) => packageKey(pkg) === selected) ?? null;

  const groupedPackages = useMemo(() => {
    return (["project", "global"] as PluginScope[])
      .map((scope) => ({ scope, packages: packages.filter((pkg) => pkg.scope === scope) }))
      .filter((group) => group.packages.length > 0);
  }, [packages]);

  const installedSources = useMemo(() => {
    const set = new Set<string>();
    for (const pkg of packages) {
      set.add(pkg.source);
      if (pkg.packageName) {
        set.add(pkg.packageName);
        set.add(`npm:${pkg.packageName}`);
      }
    }
    return set;
  }, [packages]);

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/plugins?cwd=${encodeURIComponent(cwd)}`);
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      setAddMode((current) => next.packages.length === 0 || current);
      setSelected((current) => {
        if (current && next.packages.some((pkg) => packageKey(pkg) === current)) return current;
        return next.packages[0] ? packageKey(next.packages[0]) : null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const runAction = useCallback(async (action: PluginAction, pkg: PluginPackageInfo) => {
    const key = packageKey(pkg);
    setBusyKey(`${action}:${key}`);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, source: pkg.source, scope: pkg.scope, cwd }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      if (action === "remove") {
        setSelected(next.packages[0] ? packageKey(next.packages[0]) : null);
        if (next.packages.length === 0) setAddMode(true);
        setActionMessage(t("plugins.removed"));
      } else {
        const messages: Record<Exclude<PluginAction, "remove">, string> = {
          install: t("plugins.installed"),
          update: t("plugins.updated"),
          disable: t("plugins.disabledToast"),
          enable: t("plugins.enabled"),
        };
        setActionMessage(messages[action]);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [cwd]);

  const installFromSource = useCallback(async (rawSource: string) => {
    const source = rawSource.trim();
    if (!source) return;
    const key = `${installScope}\0${source}`;
    setBusyKey(`install:${key}`);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install", source, scope: installScope, cwd }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      const installed = findInstalledPackage(next.packages, source, installScope);
      setSelected(installed ? packageKey(installed) : key);
      setAddMode(false);
      setInstallSource("");
      setActionMessage(t("plugins.installed"));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [cwd, installScope, t]);

  const installPlugin = useCallback(async () => {
    await installFromSource(installSource);
  }, [installFromSource, installSource]);

  const reloadSession = useCallback(async () => {
    if (!sessionId) return;
    setBusyKey("reload");
    setActionError(null);
    setActionMessage(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      onReloaded?.();
      await loadPlugins();
      setActionMessage(t("plugins.sessionReloaded"));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [loadPlugins, onReloaded, sessionId]);

  const addBusy = busyKey?.startsWith("install:") ?? false;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 860,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "76vh",
          maxHeight: "calc(100dvh - 16px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {t("modal.plugins")}
            </span>
            <code
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shortenPath(cwd)}
            </code>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
          <div
            style={{
              width: isMobile ? "100%" : 245,
              maxHeight: isMobile ? "40vh" : undefined,
              borderRight: isMobile ? "none" : "1px solid var(--border)",
              borderBottom: isMobile ? "1px solid var(--border)" : "none",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              background: "var(--bg-panel)",
            }}
          >
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
              {loading ? (
                <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>
                  Loading...
                </div>
              ) : error ? (
                <div style={{ padding: "10px 8px", fontSize: 11, color: "var(--destructive)" }}>
                  {error}
                </div>
              ) : packages.length === 0 ? (
                <div style={{ padding: "10px 8px", fontSize: 11, color: "var(--text-dim)" }}>
                  No plugins configured
                </div>
              ) : (
                groupedPackages.map((group) => (
                  <div key={group.scope} style={{ marginBottom: 6 }}>
                    <div
                      style={{
                        padding: "4px 8px 3px",
                        fontSize: 10,
                        fontWeight: 600,
                        color: "var(--text-dim)",
                        textTransform: "uppercase",
                      }}
                    >
                      {group.scope}
                    </div>
                    {group.packages.map((pkg) => {
                      const key = packageKey(pkg);
                      const isSelected = !addMode && selected === key;
                      return (
                        <div
                          key={key}
                          onClick={() => {
                            setSelected(key);
                            setAddMode(false);
                            setActionError(null);
                            setActionMessage(null);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            padding: "8px 8px",
                            borderRadius: 5,
                            cursor: "pointer",
                            background: isSelected ? "var(--bg-selected)" : "none",
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)";
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) e.currentTarget.style.background = "none";
                          }}
                        >
                          <span
                            style={{
                              flexShrink: 0,
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              background: statusColor(pkg.status),
                            }}
                          />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: isSelected ? 600 : 400,
                                color: "var(--text)",
                                fontFamily: "var(--font-mono)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {pkg.source}
                            </div>
                            <div
                              style={{
                                fontSize: 10,
                                color: "var(--text-dim)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                marginTop: 2,
                              }}
                            >
                              {resourceSummary(pkg)}
                            </div>
                            {(pkg.version || pkg.configuredVersion) && (
                              <div
                                style={{
                                  fontSize: 10,
                                  color: "var(--text-dim)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  marginTop: 2,
                                }}
                              >
                                {versionSummary(pkg)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
            <div style={{ padding: "8px 6px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => {
                  setAddMode(true);
                  setActionError(null);
                  setActionMessage(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 8px",
                  borderRadius: 5,
                  border: "none",
                  width: "100%",
                  cursor: "pointer",
                  background: addMode ? "var(--bg-selected)" : "none",
                  color: addMode ? "var(--accent)" : "var(--text-dim)",
                  fontSize: 12,
                }}
                onMouseEnter={(e) => {
                  if (!addMode) e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!addMode) e.currentTarget.style.background = "none";
                }}
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
                Add plugin
              </button>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              // Add mode owns its own scroll region; detail pages scroll here once.
              overflowY: addMode ? "hidden" : "auto",
              padding: addMode ? "16px 20px 12px" : 20,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {addMode ? (
              <AddPluginPanel
                cwd={cwd}
                source={installSource}
                scope={installScope}
                busy={addBusy}
                actionError={actionError}
                installedSources={installedSources}
                onSourceChange={setInstallSource}
                onScopeChange={setInstallScope}
                onInstall={installPlugin}
                onInstallSource={(src) => void installFromSource(src)}
              />
            ) : loading ? null : selectedPackage ? (
              <PackageDetail
                key={packageKey(selectedPackage)}
                pkg={selectedPackage}
                cwd={cwd}
                busyKey={busyKey}
                actionError={actionError}
                actionMessage={actionMessage}
                sessionId={sessionId}
                onAction={runAction}
                onReloadSession={reloadSession}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  fontSize: 13,
                }}
              >
                Select a package
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: 1, fontSize: 11, color: "var(--text-dim)", overflow: "hidden" }}>
            {data?.diagnostics.length ? (
              <span
                title={data.diagnostics.map((d) => `${d.type}: ${d.source ? `${d.source}: ` : ""}${d.message}`).join("\n")}
                style={{ color: data.diagnostics.some((d) => d.type === "error") ? "var(--destructive)" : "var(--text)" }}
              >
                {data.diagnostics.length} diagnostic{data.diagnostics.length === 1 ? "" : "s"}
              </span>
            ) : (
              <span>
                {data ? `${data.totals.extensions} ext · ${data.totals.skills} skills · ${data.totals.prompts} prompts · ${data.totals.themes} themes` : ""}
              </span>
            )}
          </div>
          <button onClick={() => void loadPlugins()} disabled={loading || busyKey !== null} style={buttonStyle(loading || busyKey !== null)}>
            Refresh
          </button>
          <button onClick={onClose} style={buttonStyle(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
