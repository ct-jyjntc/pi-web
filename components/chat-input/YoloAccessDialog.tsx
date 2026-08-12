/**
 * In-app confirm before switching to yolo / full-access mode.
 * Replaces window.confirm so the warning matches the rest of the UI.
 */
"use client";

import { Folder, Globe, Terminal, TriangleAlert } from "lucide-react";
import { CenteredDialog } from "../CenteredDialog";
import { Icon } from "../Icon";
import { useLocale } from "@/hooks/useLocale";

export function YoloAccessDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLocale();
  return (
    <CenteredDialog width={400} zIndex={260} labelledBy="yolo-access-title" onClose={onCancel}>
      <div style={{ padding: "14px 14px 8px", display: "flex", alignItems: "flex-start", gap: 8 }}>
        <Icon icon={TriangleAlert} size={16} strokeWidth={1.8} style={{ color: "var(--text)", marginTop: 2, flexShrink: 0 }} />
        <div
          id="yolo-access-title"
          style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text)" }}
        >
          {t("chat.modeYoloConfirmTitle")}
        </div>
      </div>
      <p style={{ margin: 0, padding: "0 14px 10px", fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>
        {t("chat.modeYoloConfirmBody")}
      </p>

      <div style={{ padding: "0 4px 4px" }}>
        {(
          [
            { icon: Folder, title: t("chat.modeYoloConfirmFiles"), desc: t("chat.modeYoloConfirmFilesDesc") },
            { icon: Terminal, title: t("chat.modeYoloConfirmShell"), desc: t("chat.modeYoloConfirmShellDesc") },
            { icon: Globe, title: t("chat.modeYoloConfirmNet"), desc: t("chat.modeYoloConfirmNetDesc") },
          ] as const
        ).map((row) => (
          <div
            key={row.title}
            className="menu-row"
            style={{ alignItems: "flex-start", height: "auto", padding: "7px 10px", cursor: "default" }}
          >
            <Icon icon={row.icon} size={14} strokeWidth={1.8} style={{ color: "var(--text-muted)", marginTop: 2, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{row.title}</div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 1, lineHeight: 1.4 }}>{row.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <p style={{ margin: 0, padding: "4px 14px 10px", fontSize: 12, lineHeight: 1.45, color: "var(--text-dim)" }}>
        {t("chat.modeYoloConfirmRisk")}
      </p>

      <div style={{ height: 1, background: "var(--border)" }} />
      <div style={{ padding: 4 }}>
        <button type="button" className="menu-row" onClick={onConfirm} style={{ color: "var(--destructive)" }}>
          <Icon icon={TriangleAlert} size={13} strokeWidth={1.8} />
          <span style={{ flex: 1 }}>{t("window.confirm")}</span>
        </button>
        <button type="button" className="menu-row" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </CenteredDialog>
  );
}
