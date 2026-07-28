"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";

type McpServerItem = {
  name: string;
  config: {
    command?: string;
    args?: string[];
    url?: string;
    disabled?: boolean;
  };
  sourcePath: string;
  sourceLabel: "agent" | "user-global" | "project" | "project-pi" | "other";
  disabled: boolean;
  editable: boolean;
};

type AdapterStatus = {
  configured: boolean;
  installed: boolean;
  packageSource: string;
};

function summarizeServer(server: McpServerItem): string {
  if (server.config.url) return server.config.url;
  const cmd = server.config.command ?? "";
  const args = Array.isArray(server.config.args) ? server.config.args.join(" ") : "";
  return [cmd, args].filter(Boolean).join(" ") || "—";
}

function sourceBadgeLabel(
  label: McpServerItem["sourceLabel"],
  t: (key: "mcp.sourceAgent" | "mcp.sourceUserGlobal" | "mcp.sourceProject" | "mcp.sourceProjectPi" | "mcp.sourceOther") => string,
): string {
  switch (label) {
    case "agent":
      return t("mcp.sourceAgent");
    case "user-global":
      return t("mcp.sourceUserGlobal");
    case "project":
      return t("mcp.sourceProject");
    case "project-pi":
      return t("mcp.sourceProjectPi");
    default:
      return t("mcp.sourceOther");
  }
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
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={loading}
      style={{
        flexShrink: 0,
        width: 34,
        height: 18,
        borderRadius: "var(--radius-pill)",
        border: "1px solid var(--border)",
        padding: 0,
        cursor: loading ? "wait" : "pointer",
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

export function McpConfig({
  cwd,
  onClose,
  embedded = false,
}: {
  cwd?: string | null;
  onClose: () => void;
  /** When true, render as a full-height settings page panel (no modal chrome). */
  embedded?: boolean;
}) {
  const { t } = useLocale();
  const [servers, setServers] = useState<McpServerItem[]>([]);
  const [adapter, setAdapter] = useState<AdapterStatus | null>(null);
  const [agentConfigPath, setAgentConfigPath] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCommand, setAddCommand] = useState("");
  const [addArgs, setAddArgs] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const res = await fetch(`/api/mcp${qs}`);
      const data = await res.json() as {
        servers?: McpServerItem[];
        adapter?: AdapterStatus;
        agentConfigPath?: string;
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setServers(data.servers ?? []);
      setAdapter(data.adapter ?? null);
      setAgentConfigPath(data.agentConfigPath ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (server: McpServerItem) => {
    setBusyName(server.name);
    setError(null);
    try {
      const res = await fetch("/api/mcp", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: server.name,
          disabled: !server.disabled,
          cwd: cwd ?? undefined,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyName(null);
    }
  };

  const remove = async (server: McpServerItem) => {
    if (!server.editable) return;
    setBusyName(server.name);
    setError(null);
    try {
      const res = await fetch("/api/mcp", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: server.name }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyName(null);
    }
  };

  const addServer = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addName,
          command: addCommand || undefined,
          args: addArgs || undefined,
          url: addUrl || undefined,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setShowAdd(false);
      setAddName("");
      setAddCommand("");
      setAddArgs("");
      setAddUrl("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const adapterOk = adapter?.configured && adapter?.installed;

  const panel = (
      <div
        role={embedded ? undefined : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-labelledby="mcp-config-title"
        className={embedded ? "settings-embedded" : "modal-shell"}
        style={embedded ? {
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          width: "100%",
          background: "var(--bg)",
        } : {
          width: "min(560px, 100%)",
          maxHeight: "min(720px, 92vh)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="modal-header" style={embedded ? { borderRadius: 0 } : undefined}>
          <div className="modal-header-meta">
            <div id="mcp-config-title" className="modal-title">{t("mcp.title")}</div>
            {agentConfigPath && (
              <code className="modal-subtitle" title={agentConfigPath}>
                {agentConfigPath.replace(/^\/Users\/[^/]+/, "~")}
              </code>
            )}
          </div>
          {!embedded && (
            <button type="button" className="chrome-btn is-icon" onClick={onClose} aria-label={t("common.close")}>
              ×
            </button>
          )}
        </div>

        <div
          className={embedded ? "settings-page-content" : "modal-main"}
          style={{
            ...(embedded
              ? { maxWidth: 820, margin: "0 auto", width: "100%", boxSizing: "border-box" as const }
              : { padding: "12px 14px" }),
            overflow: "auto",
            flex: 1,
            minHeight: 0,
          }}
        >
          <div className="settings-row-desc" style={{ marginBottom: 14 }}>
            {t("mcp.description")}
          </div>

          <div className="settings-status-card" style={{ marginBottom: 16 }}>
            <span className={`settings-status-dot${adapterOk ? " is-ok" : ""}`} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="settings-row-title" style={{ fontSize: 12 }}>{t("mcp.adapter")}</div>
              <div className="settings-row-desc">
                {adapterOk ? t("mcp.adapterReady") : t("mcp.adapterInstalling")}
              </div>
            </div>
            <code style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
              pi-mcp-adapter
            </code>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div className="settings-section-title" style={{ margin: 0 }}>
              {t("mcp.servers")}
              {servers.length > 0 ? ` · ${servers.length}` : ""}
            </div>
            <button type="button" className="chrome-btn" style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 12 }} onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? t("common.cancel") : t("mcp.addServer")}
            </button>
          </div>

          {showAdd && (
            <div
              className="settings-status-card"
              style={{
                marginTop: 10,
                marginBottom: 12,
                flexDirection: "column",
                alignItems: "stretch",
                gap: 8,
              }}
            >
              <input
                className="input-base"
                placeholder={t("mcp.namePlaceholder")}
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
              />
              <input
                className="input-base"
                placeholder={t("mcp.commandPlaceholder")}
                value={addCommand}
                onChange={(e) => setAddCommand(e.target.value)}
              />
              <input
                className="input-base"
                placeholder={t("mcp.argsPlaceholder")}
                value={addArgs}
                onChange={(e) => setAddArgs(e.target.value)}
              />
              <input
                className="input-base"
                placeholder={t("mcp.urlPlaceholder")}
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  className="btn-primary btn-compact"
                  disabled={saving || !addName.trim() || (!addCommand.trim() && !addUrl.trim())}
                  onClick={() => void addServer()}
                >
                  {saving ? t("common.saving") : t("mcp.saveServer")}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div role="alert" style={{ color: "var(--destructive)", fontSize: 12, marginBottom: 10, lineHeight: 1.4 }}>
              {error}
            </div>
          )}

          {loading ? (
            <div className="settings-row-desc" style={{ padding: "16px 0" }}>{t("common.loading")}</div>
          ) : servers.length === 0 ? (
            <div className="settings-row-desc" style={{ padding: "16px 0" }}>
              {t("mcp.empty")}
            </div>
          ) : (
            <div>
              {servers.map((server) => (
                <div key={`${server.sourcePath}:${server.name}`} className="settings-list-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span className="settings-row-title">{server.name}</span>
                      <span className="settings-badge">{sourceBadgeLabel(server.sourceLabel, t)}</span>
                      {server.disabled && (
                        <span className="settings-badge">{t("mcp.disabled")}</span>
                      )}
                    </div>
                    <div className="settings-list-meta">{summarizeServer(server)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, paddingTop: 2 }}>
                    {server.editable && (
                      <button
                        type="button"
                        className="chrome-btn"
                        style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 12 }}
                        disabled={busyName === server.name}
                        onClick={() => void remove(server)}
                        title={t("mcp.remove")}
                      >
                        {t("mcp.remove")}
                      </button>
                    )}
                    <Toggle
                      enabled={!server.disabled}
                      loading={busyName === server.name}
                      onToggle={() => void toggle(server)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="settings-row-desc" style={{ marginTop: 16, fontSize: 11, color: "var(--text-dim)" }}>
            {t("mcp.reloadHint")}
          </div>
        </div>
      </div>
  );

  if (embedded) return panel;
  return (
    <div className="modal-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {panel}
    </div>
  );
}
