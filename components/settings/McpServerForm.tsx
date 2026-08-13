/**
 * Add / edit an MCP server (stdio or streamable HTTP).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Icon } from "../Icon";
import { SettingsPageHeading } from "./settings-ui";

export type McpServerDraft = {
  name: string;
  transport: "stdio" | "http";
  command: string;
  args: string[];
  url: string;
  env: Array<{ key: string; value: string }>;
  headers: Array<{ key: string; value: string }>;
  cwd: string;
};

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordToPairs(record?: Record<string, string>): Array<{ key: string; value: string }> {
  const pairs = record
    ? Object.entries(record).map(([key, value]) => ({ key, value: String(value) }))
    : [];
  return pairs.length > 0 ? pairs : [{ key: "", value: "" }];
}

function pairsToRecord(pairs: Array<{ key: string; value: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of pairs) {
    const key = row.key.trim();
    if (key) out[key] = row.value;
  }
  return out;
}

export function draftFromConfig(name: string, config: {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: unknown;
  cwd?: unknown;
}): McpServerDraft {
  return {
    name,
    transport: config.url && !config.command ? "http" : "stdio",
    command: config.command ?? "",
    args: Array.isArray(config.args) && config.args.length > 0 ? config.args.map(String) : [""],
    url: config.url ?? "",
    env: recordToPairs(config.env),
    headers: recordToPairs(isStringRecord(config.headers) ? config.headers : undefined),
    cwd: typeof config.cwd === "string" ? config.cwd : "",
  };
}

export function emptyMcpDraft(): McpServerDraft {
  return {
    name: "",
    transport: "stdio",
    command: "",
    args: [""],
    url: "",
    env: [{ key: "", value: "" }],
    headers: [{ key: "", value: "" }],
    cwd: "",
  };
}

export function draftToPayload(draft: McpServerDraft): {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  cwd?: string;
} {
  const args = draft.args.map((a) => a.trim()).filter(Boolean);
  if (draft.transport === "http") {
    return {
      name: draft.name.trim(),
      url: draft.url.trim() || undefined,
      headers: pairsToRecord(draft.headers),
    };
  }
  return {
    name: draft.name.trim(),
    command: draft.command.trim() || undefined,
    args: args.length > 0 ? args : undefined,
    env: pairsToRecord(draft.env),
    cwd: draft.cwd.trim(),
  };
}

function PairList({
  rows,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  deleteLabel,
  onChange,
}: {
  rows: Array<{ key: string; value: string }>;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
  deleteLabel: string;
  onChange: (next: Array<{ key: string; value: string }>) => void;
}) {
  return (
    <div className="mcp-form-list">
      {rows.map((row, i) => (
        <div key={i} className="mcp-form-list-row">
          <input
            className="input-base input-mono"
            value={row.key}
            placeholder={keyPlaceholder}
            onChange={(e) => {
              const next = rows.slice();
              next[i] = { ...row, key: e.target.value };
              onChange(next);
            }}
          />
          <input
            className="input-base input-mono"
            value={row.value}
            placeholder={valuePlaceholder}
            onChange={(e) => {
              const next = rows.slice();
              next[i] = { ...row, value: e.target.value };
              onChange(next);
            }}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label={deleteLabel}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <Icon icon={Trash2} size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="chrome-btn mcp-form-add"
        onClick={() => onChange([...rows, { key: "", value: "" }])}
      >
        <Icon icon={Plus} size={12} />
        {addLabel}
      </button>
    </div>
  );
}

export function McpServerForm({
  mode,
  initial,
  saving,
  error,
  onBack,
  onSave,
  onDelete,
}: {
  mode: "add" | "edit";
  initial: McpServerDraft;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onSave: (draft: McpServerDraft) => void;
  onDelete?: () => void;
}) {
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<McpServerDraft>(initial);
  const canSave = draft.name.trim() && (
    draft.transport === "http" ? draft.url.trim() : draft.command.trim()
  );

  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "start" });
  }, []);

  const set = (patch: Partial<McpServerDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  return (
    <div className="mcp-form" ref={rootRef}>
      <button type="button" className="btn-ghost btn-compact" onClick={onBack}>
        <Icon icon={ChevronLeft} size={12} strokeWidth={1.8} />
        {t("skills.back")}
      </button>

      <SettingsPageHeading
        title={mode === "edit" ? t("mcp.editServer", { name: initial.name }) : t("mcp.connectCustom")}
        action={onDelete ? (
          <button
            type="button"
            className="btn-ghost btn-compact"
            style={{ color: "var(--destructive)" }}
            onClick={onDelete}
            disabled={saving}
          >
            {t("mcp.remove")}
          </button>
        ) : undefined}
      />

      {error && (
        <div className="settings-card-empty" role="alert" style={{ color: "var(--destructive)", marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="settings-card" style={{ marginBottom: 16 }}>
        <label className="settings-row is-stacked">
          <span className="settings-row-title">{t("mcp.fieldName")}</span>
          <input
            className="input-base"
            value={draft.name}
            disabled={mode === "edit"}
            placeholder={t("mcp.namePlaceholder")}
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <div className="settings-row">
          <div className="settings-row-title">{t("mcp.transport")}</div>
          <div className="settings-segmented">
            <button
              type="button"
              className={`chrome-btn${draft.transport === "stdio" ? " is-active" : ""}`}
              aria-pressed={draft.transport === "stdio"}
              onClick={() => set({ transport: "stdio" })}
            >
              {t("mcp.transportStdio")}
            </button>
            <button
              type="button"
              className={`chrome-btn${draft.transport === "http" ? " is-active" : ""}`}
              aria-pressed={draft.transport === "http"}
              onClick={() => set({ transport: "http" })}
            >
              {t("mcp.transportHttp")}
            </button>
          </div>
        </div>
      </div>

      {draft.transport === "http" ? (
        <div className="settings-card" style={{ marginBottom: 16 }}>
          <label className="settings-row is-stacked">
            <span className="settings-row-title">{t("mcp.fieldUrl")}</span>
            <input
              className="input-base"
              value={draft.url}
              placeholder={t("mcp.urlPlaceholder")}
              onChange={(e) => set({ url: e.target.value })}
            />
          </label>
          <div className="settings-row is-stacked">
            <span className="settings-row-title">{t("mcp.headers")}</span>
            <PairList
              rows={draft.headers}
              keyPlaceholder={t("mcp.envKey")}
              valuePlaceholder={t("mcp.envValue")}
              addLabel={t("mcp.addHeader")}
              deleteLabel={t("common.delete")}
              onChange={(headers) => set({ headers })}
            />
          </div>
        </div>
      ) : (
        <div className="settings-card" style={{ marginBottom: 16 }}>
          <label className="settings-row is-stacked">
            <span className="settings-row-title">{t("mcp.command")}</span>
            <input
              className="input-base input-mono"
              value={draft.command}
              placeholder={t("mcp.commandPlaceholder")}
              onChange={(e) => set({ command: e.target.value })}
            />
          </label>
          <div className="settings-row is-stacked">
            <span className="settings-row-title">{t("mcp.args")}</span>
            <div className="mcp-form-list">
              {draft.args.map((arg, i) => (
                <div key={i} className="mcp-form-list-row">
                  <input
                    className="input-base input-mono"
                    value={arg}
                    placeholder={t("mcp.argsPlaceholder")}
                    onChange={(e) => {
                      const next = draft.args.slice();
                      next[i] = e.target.value;
                      set({ args: next });
                    }}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t("common.delete")}
                    onClick={() => set({ args: draft.args.filter((_, j) => j !== i) })}
                  >
                    <Icon icon={Trash2} size={13} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="chrome-btn mcp-form-add"
                onClick={() => set({ args: [...draft.args, ""] })}
              >
                <Icon icon={Plus} size={12} />
                {t("mcp.addArg")}
              </button>
            </div>
          </div>
          <div className="settings-row is-stacked">
            <span className="settings-row-title">{t("mcp.env")}</span>
            <PairList
              rows={draft.env}
              keyPlaceholder={t("mcp.envKey")}
              valuePlaceholder={t("mcp.envValue")}
              addLabel={t("mcp.addEnv")}
              deleteLabel={t("common.delete")}
              onChange={(env) => set({ env })}
            />
          </div>
          <label className="settings-row is-stacked">
            <span className="settings-row-title">{t("mcp.cwd")}</span>
            <input
              className="input-base input-mono"
              value={draft.cwd}
              placeholder={t("mcp.cwdPlaceholder")}
              onChange={(e) => set({ cwd: e.target.value })}
            />
          </label>
        </div>
      )}

      <div className="mcp-form-actions">
        <button
          type="button"
          className="btn-primary btn-compact"
          disabled={saving || !canSave}
          onClick={() => onSave(draft)}
        >
          {saving ? t("common.saving") : t("mcp.saveServer")}
        </button>
      </div>
    </div>
  );
}
