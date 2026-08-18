"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Icon } from "../Icon";
import { useLocale } from "@/hooks/useLocale";

export function ReadOnlyValue({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <div
      className={`input-base${mono ? " input-mono" : ""}`}
      style={{
        opacity: 0.9,
        cursor: "default",
        pointerEvents: "none",
        userSelect: "text",
        background: "var(--bg-subtle)",
        borderStyle: "dashed",
        color: "var(--text-muted)",
      }}
      title="Locked (from provider catalog)"
      aria-readonly="true"
    >
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // Settings grammar: stacked row (label above control); a .settings-card
  // parent supplies padding and the divider between rows.
  return (
    <div className="settings-row is-stacked">
      <div className="settings-row-copy">
        <div className="settings-row-title">{label}</div>
      </div>
      <div className="settings-row-action">{children}</div>
    </div>
  );
}

export function TextInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input
      className={`input-base${mono ? " input-mono" : ""}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

export function SecretTextInput({
  value,
  onChange,
  placeholder,
  mono,
  onKeyDown,
  autoComplete = "off",
  spellCheck = false,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  autoComplete?: string;
  spellCheck?: boolean;
  style?: React.CSSProperties;
}) {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div style={{ position: "relative", width: "100%", ...style }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={`input-base${mono ? " input-mono" : ""}`}
        style={{ paddingRight: 34 }}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("models.hideKey") : t("models.showKey")}
        title={visible ? t("models.hideKey") : t("models.showKey")}
        className="icon-btn"
        style={{
          "--icon-btn-size": "24px",
          position: "absolute",
          right: 5,
          top: "50%",
          transform: "translateY(-50%)",
        } as React.CSSProperties}
      >
        {visible ? (
          <Icon icon={EyeOff} size={15} strokeWidth={2} />
        ) : (
          <Icon icon={Eye} size={15} strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

export function NumInput({ value, onChange, placeholder, onBlur, onKeyDown }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  return (
    <input
      type="number"
      className="input-base"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
    />
  );
}

export function Select({ value, onChange, options, required }: { value: string; onChange: (v: string) => void; options: readonly string[]; required?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="input-base"
      style={{ color: value ? "var(--text)" : "var(--text-dim)" }}>
      {!required && <option value="">— inherit / none —</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 13, height: 13, accentColor: "var(--accent)", cursor: "pointer" }} />
      {label}
    </label>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="settings-group-title" style={{ margin: 0 }}>{children}</div>;
}

/** Detail strip: title left, actions right — settings group-head grammar */
export function DetailStrip({
  title,
  actions,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="settings-group-head">
      <h3 className="settings-group-title">{title}</h3>
      {actions ? <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>{actions}</div> : null}
    </div>
  );
}
