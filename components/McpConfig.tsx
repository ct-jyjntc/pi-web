"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { ConfigPanelBackdrop, ConfigPanelShell } from "./ConfigPanelShell";
import { SettingsToggle } from "./SettingsToggle";
import { SettingsGroup, SettingsPageHeading, SettingsRow } from "./settings/settings-ui";
import { apiFetch } from "@/lib/api-transport";

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
      const res = await apiFetch(`/api/mcp${qs}`);
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
      const res = await apiFetch("/api/mcp", {
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
      const res = await apiFetch("/api/mcp", {
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
      const res = await apiFetch("/api/mcp", {
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

  const body = (
    <>
      {embedded ? (
        <SettingsPageHeading title={t("mcp.title")} description={t("mcp.description")} />
      ) : (
        <div className="settings-row-desc" style={{ marginBottom: 14 }}>
          {t("mcp.description")}
        </div>
      )}

      <SettingsGroup title={t("mcp.adapter")}>
        <SettingsRow
          title={t("mcp.adapter")}
          description={adapterOk ? t("mcp.adapterReady") : t("mcp.adapterInstalling")}
          action={
            <span className={`settings-status-dot${adapterOk ? " is-ok" : ""}`} title="native" />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title={`${t("mcp.servers")}${servers.length > 0 ? ` · ${servers.length}` : ""}`}
        action={
          <button type="button" className="btn-ghost btn-compact" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? t("common.cancel") : t("mcp.addServer")}
          </button>
        }
      >
        {showAdd && (
          <div className="settings-row is-stacked">
            <input className="input-base" placeholder={t("mcp.namePlaceholder")} value={addName} onChange={(e) => setAddName(e.target.value)} />
            <input className="input-base" placeholder={t("mcp.commandPlaceholder")} value={addCommand} onChange={(e) => setAddCommand(e.target.value)} />
            <input className="input-base" placeholder={t("mcp.argsPlaceholder")} value={addArgs} onChange={(e) => setAddArgs(e.target.value)} />
            <input className="input-base" placeholder={t("mcp.urlPlaceholder")} value={addUrl} onChange={(e) => setAddUrl(e.target.value)} />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
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
          <div className="settings-card-empty" role="alert" style={{ color: "var(--destructive)" }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="settings-card-empty">{t("common.loading")}</div>
        ) : servers.length === 0 ? (
          <div className="settings-card-empty">{t("mcp.empty")}</div>
        ) : (
          servers.map((server) => (
            <SettingsRow
              key={`${server.sourcePath}:${server.name}`}
              title={server.name}
              description={`${sourceBadgeLabel(server.sourceLabel, t)} · ${summarizeServer(server)}`}
              action={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {server.editable && (
                    <button
                      type="button"
                      className="btn-ghost btn-compact"
                      style={{ color: "var(--destructive)" }}
                      disabled={busyName === server.name}
                      onClick={() => void remove(server)}
                      title={t("mcp.remove")}
                    >
                      {t("mcp.remove")}
                    </button>
                  )}
                  <SettingsToggle
                    enabled={!server.disabled}
                    loading={busyName === server.name}
                    onChange={() => void toggle(server)}
                  />
                </div>
              }
            />
          ))
        )}
      </SettingsGroup>

      <div className="settings-row-desc" style={{ fontSize: 11, color: "var(--text-dim)" }}>
        {t("mcp.reloadHint")}
        {agentConfigPath ? ` · ${agentConfigPath.replace(/^\/Users\/[^/]+/, "~")}` : ""}
      </div>
    </>
  );

  const panel = embedded ? (
    <div className="settings-page-general">{body}</div>
  ) : (
    <ConfigPanelShell
      titleId="mcp-config-title"
      title={t("mcp.title")}
      subtitle={agentConfigPath ? (
        <code className="modal-subtitle" title={agentConfigPath}>
          {agentConfigPath.replace(/^\/Users\/[^/]+/, "~")}
        </code>
      ) : undefined}
      onClose={onClose}
      closeAriaLabel={t("common.close")}
      style={{
        width: "min(560px, 100%)",
        maxHeight: "min(720px, 92vh)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="modal-main" style={{ overflow: "auto", flex: 1, minHeight: 0, padding: 16 }}>
        {body}
      </div>
    </ConfigPanelShell>
  );

  if (embedded) return panel;
  return (
    <ConfigPanelBackdrop onClose={onClose}>
      {panel}
    </ConfigPanelBackdrop>
  );
}
