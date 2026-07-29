"use client";

/**
 * Shared quiet switch for settings-style surfaces (settings page, MCP, skills).
 * Visuals live in globals.css (.settings-toggle); do not restyle inline.
 */
export function SettingsToggle({
  enabled,
  onChange,
  disabled = false,
  loading = false,
  title,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Busy state: inert control with a wait cursor. */
  loading?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled || loading}
      title={title}
      onClick={() => onChange(!enabled)}
      className={`settings-toggle${enabled ? " is-on" : ""}`}
      style={loading ? { cursor: "wait" } : undefined}
    >
      <span className="settings-toggle-knob" />
    </button>
  );
}
