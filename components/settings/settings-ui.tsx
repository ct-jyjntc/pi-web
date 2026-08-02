"use client";

import type { MouseEvent, ReactNode } from "react";
import type { WebSettingsModelOption } from "@/lib/web-settings-store";

export type LspServerRow = {
  id: string;
  label: string;
  command: string;
  languages: string[];
  available: boolean;
  resolvedPath: string | null;
  /** Platform-resolved install command (not brew-first). */
  install: string;
  installTip?: string;
  brew?: string;
  platform?: string;
};

export function modelValue(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

export function ModelSelect({
  value,
  models,
  loading,
  disabled = false,
  placeholder,
  ariaLabel,
  unavailableLabel,
  onChange,
}: {
  value: string;
  models: WebSettingsModelOption[];
  loading: boolean;
  disabled?: boolean;
  placeholder: string;
  ariaLabel: string;
  unavailableLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="input-base input-mono"
      value={value}
      disabled={loading || disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: "100%", maxWidth: "100%" }}
      aria-label={ariaLabel}
    >
      <option value="">{placeholder}</option>
      {models.map((model) => {
        const ref = modelValue(model.provider, model.modelId);
        return (
          <option key={ref} value={ref}>
            {model.name} · {model.provider}
          </option>
        );
      })}
      {value && !models.some((model) => modelValue(model.provider, model.modelId) === value) && (
        <option value={value}>{value} ({unavailableLabel})</option>
      )}
    </select>
  );
}

export function SegmentedOption({
  active,
  label,
  onClick,
  title,
}: {
  active: boolean;
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`chrome-btn${active ? " is-active" : ""}`}
      onClick={onClick}
      title={title}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

export function SettingsRow({
  title,
  description,
  action,
  stacked = false,
}: {
  title: string;
  description?: string;
  action: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className={`settings-row${stacked ? " is-stacked" : ""}`}>
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div className="settings-row-title">{title}</div>
        {description && <div className="settings-row-desc">{description}</div>}
      </div>
      <div style={{ flexShrink: 0, width: stacked ? "100%" : undefined }}>{action}</div>
    </div>
  );
}

export function sectionTitle(text: string) {
  return <div className="settings-section-title">{text}</div>;
}


