"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { ConfigPanelBackdrop, ConfigPanelShell } from "./ConfigPanelShell";
import { SettingsToggle } from "./SettingsToggle";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsGroup, SettingsPageHeading, SettingsRow } from "./settings/settings-ui";
import {
  draftFromConfig,
  draftToPayload,
  emptyMcpDraft,
  McpServerForm,
  type McpServerDraft,
} from "./settings/McpServerForm";
import { apiFetch } from "@/lib/api-transport";

type McpServerItem = {
  name: string;
  config: {
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    headers?: Record<string, string>;
    cwd?: string;
    disabled?: boolean;
  };
  sourcePath: string;
  sourceLabel: "agent" | "user-global" | "project" | "project-pi" | "other";
  disabled: boolean;
  editable: boolean;
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
  hideHeading = false,
  onCountChange,
  onFormChange,
  addRequestKey = 0,
}: {
  cwd?: string | null;
  onClose: () => void;
  embedded?: boolean;
  hideHeading?: boolean;
  onCountChange?: (n: number) => void;
  onFormChange?: (open: boolean) => void;
  addRequestKey?: number;
}) {
  const { t } = useLocale();
  const [servers, setServers] = useState<McpServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [form, setForm] = useState<"add" | "edit" | null>(null);
  const [formInitial, setFormInitial] = useState<McpServerDraft>(() => emptyMcpDraft());
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<McpServerItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const res = await apiFetch(`/api/mcp${qs}`);
      const data = await res.json() as {
        servers?: McpServerItem[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setServers(data.servers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onCountChange?.(servers.length);
  }, [onCountChange, servers.length]);

  useEffect(() => {
    if (addRequestKey > 0) {
      setFormInitial(emptyMcpDraft());
      setForm("add");
      setError(null);
    }
  }, [addRequestKey]);

  useEffect(() => {
    onFormChange?.(form !== null);
  }, [form, onFormChange]);

  useEffect(() => () => onFormChange?.(false), [onFormChange]);

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
      setPendingDelete(null);
      setForm(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyName(null);
    }
  };

  const saveServer = async (draft: McpServerDraft) => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToPayload(draft)),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setForm(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const body = form ? (
    <McpServerForm
      mode={form}
      initial={formInitial}
      saving={saving}
      error={error}
      onBack={() => {
        setForm(null);
        setError(null);
      }}
      onSave={(draft) => void saveServer(draft)}
      onDelete={form === "edit"
        ? () => {
            const server = servers.find((s) => s.name === formInitial.name);
            if (server) setPendingDelete(server);
          }
        : undefined}
    />
  ) : (
    <>
      {!hideHeading && (embedded ? (
        <SettingsPageHeading title={t("mcp.title")} description={t("mcp.description")} />
      ) : (
        <div className="settings-row-desc" style={{ marginBottom: 14 }}>
          {t("mcp.description")}
        </div>
      ))}

      <div className="plugin-catalog">
      <SettingsGroup title={t("mcp.servers")}>
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
              onClick={server.editable ? () => {
                setFormInitial(draftFromConfig(server.name, server.config));
                setForm("edit");
                setError(null);
              } : undefined}
              action={
                <SettingsToggle
                  enabled={!server.disabled}
                  loading={busyName === server.name}
                  onChange={() => void toggle(server)}
                />
              }
            />
          ))
        )}
      </SettingsGroup>
      </div>
      <div className="settings-row-desc" style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 12 }}>
        {t("mcp.reloadHint")}
      </div>
    </>
  );

  const confirm = pendingDelete ? (
    <ConfirmDialog
      title={t("mcp.removeConfirm", { name: pendingDelete.name })}
      body={t("mcp.removeConfirmBody")}
      confirmLabel={t("mcp.remove")}
      destructive
      busy={busyName === pendingDelete.name}
      onConfirm={() => void remove(pendingDelete)}
      onCancel={() => setPendingDelete(null)}
    />
  ) : null;

  if (embedded) {
    return (
      <>
        {body}
        {confirm}
      </>
    );
  }

  return (
    <ConfigPanelBackdrop onClose={onClose}>
      <ConfigPanelShell
        titleId="mcp-config-title"
        title={t("mcp.title")}
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
      {confirm}
    </ConfigPanelBackdrop>
  );
}
