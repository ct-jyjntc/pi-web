/**
 * Settings → General: language, terminal, notifications, desktop, updates, about.
 */

"use client";

import type { ReactNode } from "react";
import { useLocale } from "@/hooks/useLocale";
import { SettingsToggle } from "../SettingsToggle";
import {
  SegmentedOption,
  SettingsGroup,
  SettingsPageHeading,
  SettingsRow,
} from "./settings-ui";

export type GeneralPrefs = {
  inheritTerminalEnv: boolean;
  terminalFont: string;
  desktopNotifications: boolean;
  soundEnabled: boolean;
  notificationSound: boolean;
  disableHardwareAcceleration: boolean;
  autoCheckUpdates: boolean;
  autoDownloadUpdates: boolean;
};

export type GeneralUpdateStatus =
  | { kind: "idle" }
  | { kind: "available"; version: string; releaseUrl: string }
  | { kind: "latest" }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export function GeneralSettingsPanel({
  prefs,
  onTerminalFont,
  patchPref,
  isDesktop,
  restartHint,
  currentVersion,
  updateStatus,
  updateChecking,
  checkForAppUpdate,
  saveErrorBlock,
}: {
  prefs: GeneralPrefs;
  onTerminalFont: (value: string) => void;
  patchPref: (patch: Record<string, unknown>, opts?: { restart?: boolean }) => void | Promise<void>;
  isDesktop: boolean;
  restartHint: boolean;
  currentVersion: string | null;
  updateStatus: GeneralUpdateStatus;
  updateChecking: boolean;
  checkForAppUpdate: () => void | Promise<void>;
  saveErrorBlock: ReactNode;
}) {
  const { t, locale, setLocale } = useLocale();

  return (
    <>
      <SettingsPageHeading title={t("settings.general")} />

      <SettingsGroup>
        <SettingsRow
          title={t("settings.language")}
          description={t("settings.languageDesc")}
          action={
            <div className="settings-segmented">
              <SegmentedOption
                active={locale === "en"}
                label={t("settings.languageEn")}
                title={t("shell.switchToEn")}
                onClick={() => setLocale("en")}
              />
              <SegmentedOption
                active={locale === "zh"}
                label={t("settings.languageZh")}
                title={t("shell.switchToZh")}
                onClick={() => setLocale("zh")}
              />
            </div>
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.terminalSection")}>
        <SettingsRow
          title={t("settings.inheritTerminalEnv")}
          description={t("settings.inheritTerminalEnvDesc")}
          action={
            <SettingsToggle
              enabled={prefs.inheritTerminalEnv}
              onChange={(next) => void patchPref({ inheritTerminalEnv: next })}
            />
          }
        />
        <SettingsRow
          stacked
          title={t("settings.terminalFont")}
          description={t("settings.terminalFontDesc")}
          action={
            <input
              className="input-base input-mono"
              value={prefs.terminalFont}
              placeholder={t("settings.terminalFontPlaceholder")}
              onChange={(e) => onTerminalFont(e.target.value)}
              onBlur={() => void patchPref({ terminalFont: prefs.terminalFont })}
              style={{ width: "100%" }}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.notificationsSection")}>
        <SettingsRow
          title={t("settings.desktopNotifications")}
          description={t("settings.desktopNotificationsDesc")}
          action={
            <SettingsToggle
              enabled={prefs.desktopNotifications}
              onChange={(next) => {
                void (async () => {
                  if (next) {
                    const desktop = typeof window !== "undefined" ? window.piDesktop : undefined;
                    if (desktop?.isDesktop && typeof desktop.notify === "function") {
                      void desktop.notify({
                        title: "Pi Web",
                        body: t("notify.taskComplete"),
                        silent: !prefs.notificationSound,
                        force: true,
                      });
                    } else if (typeof Notification !== "undefined") {
                      if (Notification.permission === "default") {
                        await Notification.requestPermission();
                      }
                      if (Notification.permission === "granted") {
                        try {
                          new Notification("Pi Web", {
                            body: t("notify.taskComplete"),
                            silent: !prefs.notificationSound,
                          });
                        } catch {
                          // ignore
                        }
                      }
                    }
                  }
                  void patchPref({ desktopNotifications: next });
                })();
              }}
            />
          }
        />
        <SettingsRow
          title={t("settings.soundEnabled")}
          description={t("settings.soundEnabledDesc")}
          action={
            <SettingsToggle
              enabled={prefs.soundEnabled}
              onChange={(next) => void patchPref({ soundEnabled: next })}
            />
          }
        />
        <SettingsRow
          title={t("settings.notificationSound")}
          description={t("settings.notificationSoundDesc")}
          action={
            <SettingsToggle
              enabled={prefs.notificationSound}
              onChange={(next) => void patchPref({ notificationSound: next })}
            />
          }
        />
      </SettingsGroup>

      {isDesktop && (
        <SettingsGroup title={t("settings.desktopSection")}>
          <SettingsRow
            title={t("settings.disableGpu")}
            description={t("settings.disableGpuDesc")}
            action={
              <SettingsToggle
                enabled={prefs.disableHardwareAcceleration}
                onChange={(next) => void patchPref({ disableHardwareAcceleration: next }, { restart: true })}
              />
            }
          />
        </SettingsGroup>
      )}

      <SettingsGroup title={t("settings.updatesSection")}>
        <SettingsRow
          title={t("settings.autoCheckUpdates")}
          description={t("settings.autoCheckUpdatesDesc")}
          action={
            <SettingsToggle
              enabled={prefs.autoCheckUpdates}
              onChange={(next) => void patchPref({ autoCheckUpdates: next })}
            />
          }
        />
        <SettingsRow
          title={t("settings.autoDownloadUpdates")}
          description={t("settings.autoDownloadUpdatesDesc")}
          action={
            <SettingsToggle
              enabled={prefs.autoDownloadUpdates}
              onChange={(next) => void patchPref({ autoDownloadUpdates: next })}
            />
          }
        />
      </SettingsGroup>

      {restartHint && (
        <div className="settings-status-card" style={{ marginBottom: 22, color: "var(--text-muted)" }}>
          {t("settings.restartRequired")}
        </div>
      )}

      <SettingsGroup title={t("settings.about")}>
        <SettingsRow
          title={t("settings.version")}
          description={
            currentVersion
              ? t("settings.versionCurrent", { version: currentVersion })
              : t("common.loading")
          }
          action={
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {updateStatus.kind === "available" && (
                <button
                  type="button"
                  className="btn-primary btn-compact"
                  onClick={() => {
                    window.open(updateStatus.releaseUrl, "_blank", "noopener,noreferrer");
                  }}
                >
                  {t("settings.updateOpen")}
                </button>
              )}
              <button
                type="button"
                className="btn-ghost btn-compact"
                onClick={() => void checkForAppUpdate()}
                disabled={updateChecking}
              >
                {updateChecking ? t("settings.checkingUpdate") : t("settings.checkUpdate")}
              </button>
            </div>
          }
        />
      </SettingsGroup>

      {updateStatus.kind === "available" && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--success)", lineHeight: 1.4 }}>
          {t("settings.updateAvailable", { version: updateStatus.version })}
        </div>
      )}
      {updateStatus.kind === "latest" && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
          {t("settings.updateLatest")}
        </div>
      )}
      {updateStatus.kind === "empty" && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
          {t("settings.updateNoReleases")}
        </div>
      )}
      {updateStatus.kind === "error" && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--destructive)", lineHeight: 1.4 }}>
          {t("settings.updateError")}: {updateStatus.message}
        </div>
      )}
      {saveErrorBlock}
    </>
  );
}
