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
  active = false,
  onClick,
}: {
  title: ReactNode;
  description?: ReactNode;
  action: ReactNode;
  stacked?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={`settings-row${stacked ? " is-stacked" : ""}${onClick ? " is-clickable" : ""}${active ? " is-active" : ""}`}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      } : undefined}
    >
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
        {description && <div className="settings-row-desc">{description}</div>}
      </div>
      <div
        className="settings-row-action"
        onClick={onClick ? (event) => event.stopPropagation() : undefined}
        onKeyDown={onClick ? (event) => event.stopPropagation() : undefined}
      >
        {action}
      </div>
    </div>
  );
}

export function SettingsGroup({
  title,
  action,
  framed = true,
  children,
}: {
  title?: string;
  action?: ReactNode;
  /** When false, title sits above children with no card shell (sparse charts). */
  framed?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="settings-group">
      {(title || action) ? (
        <div className="settings-group-head">
          {title ? <h3 className="settings-group-title">{title}</h3> : <span />}
          {action}
        </div>
      ) : null}
      {framed ? <div className="settings-card">{children}</div> : children}
    </section>
  );
}

export function SettingsPageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className={`settings-page-heading${action ? " is-split" : ""}`}>
      <div className="settings-page-heading-copy">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function sectionTitle(text: string) {
  return <div className="settings-section-title">{text}</div>;
}

