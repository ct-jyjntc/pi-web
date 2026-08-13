"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "@/hooks/useTheme";
import { useLocale } from "@/hooks/useLocale";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ModelsConfig } from "./ModelsConfig";
import type { SkillInfo } from "@/lib/api-types";
import { AgentBehaviorSettings } from "./settings/AgentBehaviorSettings";
import { PluginsSettings } from "./settings/PluginsSettings";
import { AdvisorSettingsPanel } from "./settings/AdvisorSettingsPanel";
import { GeneralSettingsPanel } from "./settings/GeneralSettingsPanel";
import { UsagePanel, prefetchUsage } from "./UsagePanel";
import { setAppearanceSnapshot, useAppearance } from "@/lib/appearance-store";
import { getAppUpdateInfo, setAppUpdateInfo, subscribeAppUpdate } from "@/lib/app-update-store";
import {
  fetchWebSettingsWithModels,
  saveWebSettings,
  type WebSettingsModelOption,
} from "@/lib/web-settings-store";
import { defaultLeanModeSettings, type LeanModeSettings } from "@/lib/lean-mode-settings";
import { useAgentModelThinkingSettings, type AgentModelSaveKey } from "@/hooks/use-agent-model-thinking-settings";
import { Icon } from "./Icon";
import { WindowControls } from "./WindowControls";
import { ChevronLeft } from "lucide-react";

export type SettingsSection =
  | "general"
  | "agent"
  | "memory"
  | "permissions"
  | "usage"
  | "appearance"
  | "accounts"
  | "models"
  | "plugins"
  | "skills"
  | "mcp"
  | "tools";

import {
  SettingsPageHeading,
  type LspServerRow,
} from "./settings/settings-ui";
import { AccountsSettingsPanel } from "./settings/AccountsSettingsPanel";
import { ToolsSettingsPanel } from "./settings/ToolsSettingsPanel";
import { AgentModelsSettingsPanel } from "./settings/AgentModelsSettingsPanel";
import { MemorySettingsPanel } from "./settings/MemorySettingsPanel";
import { AppearanceSettingsPanel } from "./settings/AppearanceSettingsPanel";
import { PermissionsSettingsPanel } from "./settings/PermissionsSettingsPanel";
import { apiFetch } from "@/lib/api-transport";

export function SettingsPage({
  onClose,
  cwd = null,
  skillsDisabled = false,
  initialSection = "general",
  onModelsChanged,
  visible = true,
  onTrySkill,
}: {
  onClose: () => void;
  cwd?: string | null;
  skillsDisabled?: boolean;
  initialSection?: SettingsSection;
  onModelsChanged?: () => void;
  onTrySkill?: (skill: SkillInfo) => void;
  /** AppShell keeps the page warm-mounted after first use / idle warmup and
   * toggles this instead of unmounting, so reopening is instant and state
   * (section, models, prefs) survives. */
  visible?: boolean;
}) {
  const { t } = useLocale();
  const { isDark, setThemeMode, themeMode } = useTheme();
  const appearance = useAppearance();
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const [section, setSection] = useState<SettingsSection>(
    initialSection === "skills" || initialSection === "mcp" ? "plugins" : initialSection,
  );
  const [lspServers, setLspServers] = useState<LspServerRow[] | null>(null);
  const [lspMeta, setLspMeta] = useState<{ availableCount: number; total: number; builtinNote?: string } | null>(null);
  const [lspLoading, setLspLoading] = useState(false);
  const [lspError, setLspError] = useState<string | null>(null);
  const [lspCopiedId, setLspCopiedId] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);
  // Body scroll is locked only while the overlay is actually visible — the page
  // may be warm-mounted hidden so a reopen is instant.
  useEffect(() => {
    if (!visible) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [visible]);
  const [models, setModels] = useState<WebSettingsModelOption[]>([]);
  const [titleModelRef, setTitleModelRef] = useState("");
  const [commitModelRef, setCommitModelRef] = useState("");
  const [roleDefaultRef, setRoleDefaultRef] = useState("");
  const [roleSmolRef, setRoleSmolRef] = useState("");
  const [rolePlanRef, setRolePlanRef] = useState("");
  const [loadingModels, setLoadingModels] = useState(true);
  /** Bumped after ModelsConfig mutations so agent dropdowns re-fetch with ?fresh=1. */
  const [modelsCatalogKey, setModelsCatalogKey] = useState(0);
  const [savingKey, setSavingKey] = useState<AgentModelSaveKey | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const {
    titleModelThinking,
    commitModelThinking,
    advisorModelThinking,
    roleDefaultThinking,
    roleSmolThinking,
    rolePlanThinking,
    applySettings: applyModelSettings,
    saveModelThinking,
    saveRoleThinking,
  } = useAgentModelThinkingSettings({ setSavingKey, setSaveError });
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<
    | { kind: "idle" }
    | { kind: "latest" }
    | { kind: "available"; version: string; releaseUrl: string }
    | { kind: "empty" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [prefs, setPrefs] = useState({
    soundEnabled: true,
    desktopNotifications: true,
    notificationSound: true,
    defaultThinkingLevel: "auto",
     showThinking: true,
     showTodos: true,
     expandReviewDiffs: false,
     subagentConcurrencyEnabled: true,
     subagentConcurrencyMax: 4,
    terminalFont: "",
    inheritTerminalEnv: true,
    disableHardwareAcceleration: false,
    autoCheckUpdates: true,
    autoDownloadUpdates: false,
    projectMemoryEnabled: false,
    projectMemoryAutoInject: false,
    projectMemoryTopK: 12,
    advisorEnabled: false,
  });
  const [leanMode, setLeanMode] = useState<LeanModeSettings>(() => defaultLeanModeSettings());
  const [advisorModelRef, setAdvisorModelRef] = useState("");
  const [restartHint, setRestartHint] = useState(false);
  const isDesktop = typeof window !== "undefined" && Boolean(window.piDesktop?.isDesktop);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, visible]);

  useEffect(() => {
      let cancelled = false;
      setLoadingModels(true);
      setSaveError(null);
      // Settings object is light/fast. Model catalog is heavy — apply prefs as soon
      // as settings arrive so panels stop spinning while models still load.
      const applySettingsPayload = (data: {
        settings: import("@/lib/web-settings-store").WebSettingsData | null;
        models?: import("@/lib/web-settings-store").WebSettingsModelOption[];
      }) => {
        if (cancelled) return;
        if (data.models) setModels(data.models);
        setTitleModelRef(data.settings?.titleModelRef ?? "");
        setCommitModelRef(data.settings?.commitModelRef ?? "");
        setRoleDefaultRef(data.settings?.modelRolesRefs?.default ?? "");
        setRoleSmolRef(data.settings?.modelRolesRefs?.smol ?? "");
        setRolePlanRef(data.settings?.modelRolesRefs?.plan ?? "");
        applyModelSettings(data.settings);
        const s = data.settings ?? {};
        // Network settings UI was removed — clear leftover proxy/CA so they
        // cannot keep breaking OAuth / model calls after the page is gone.
        if (
          (typeof s.httpProxy === "string" && s.httpProxy.trim()) ||
          (typeof s.proxyBypass === "string" && s.proxyBypass.trim()) ||
          (typeof s.customCaCerts === "string" && s.customCaCerts.trim())
        ) {
          void saveWebSettings({ httpProxy: "", proxyBypass: "", customCaCerts: "" });
        }
        setPrefs((prev) => ({
          ...prev,
          soundEnabled: typeof s.soundEnabled === "boolean" ? s.soundEnabled : prev.soundEnabled,
          desktopNotifications: typeof s.desktopNotifications === "boolean" ? s.desktopNotifications : prev.desktopNotifications,
          notificationSound: typeof s.notificationSound === "boolean" ? s.notificationSound : prev.notificationSound,
          defaultThinkingLevel: typeof s.defaultThinkingLevel === "string" ? s.defaultThinkingLevel : prev.defaultThinkingLevel,
           showThinking: typeof s.showThinking === "boolean" ? s.showThinking : prev.showThinking,
           showTodos: typeof s.showTodos === "boolean" ? s.showTodos : prev.showTodos,
           expandReviewDiffs: typeof s.expandReviewDiffs === "boolean" ? s.expandReviewDiffs : prev.expandReviewDiffs,
           subagentConcurrencyEnabled:
             s.subagentConcurrency && typeof s.subagentConcurrency === "object" && !Array.isArray(s.subagentConcurrency)
             && typeof (s.subagentConcurrency as { enabled?: unknown }).enabled === "boolean"
               ? (s.subagentConcurrency as { enabled: boolean }).enabled
               : prev.subagentConcurrencyEnabled,
           subagentConcurrencyMax:
             s.subagentConcurrency && typeof s.subagentConcurrency === "object" && !Array.isArray(s.subagentConcurrency)
             && typeof (s.subagentConcurrency as { max?: unknown }).max === "number"
               ? (s.subagentConcurrency as { max: number }).max
               : prev.subagentConcurrencyMax,
          terminalFont: typeof s.terminalFont === "string" ? s.terminalFont : prev.terminalFont,
          inheritTerminalEnv: typeof s.inheritTerminalEnv === "boolean" ? s.inheritTerminalEnv : prev.inheritTerminalEnv,
          disableHardwareAcceleration: typeof s.disableHardwareAcceleration === "boolean" ? s.disableHardwareAcceleration : prev.disableHardwareAcceleration,
          autoCheckUpdates: typeof s.autoCheckUpdates === "boolean" ? s.autoCheckUpdates : prev.autoCheckUpdates,
          autoDownloadUpdates: typeof s.autoDownloadUpdates === "boolean" ? s.autoDownloadUpdates : prev.autoDownloadUpdates,
          projectMemoryEnabled:
            s.projectMemory && typeof s.projectMemory === "object" && !Array.isArray(s.projectMemory)
            && typeof (s.projectMemory as { enabled?: unknown }).enabled === "boolean"
              ? (s.projectMemory as { enabled: boolean }).enabled
              : prev.projectMemoryEnabled,
          projectMemoryAutoInject:
            s.projectMemory && typeof s.projectMemory === "object" && !Array.isArray(s.projectMemory)
              ? (s.projectMemory as { autoInject?: unknown }).autoInject === true
              : prev.projectMemoryAutoInject,
          projectMemoryTopK:
            s.projectMemory && typeof s.projectMemory === "object" && !Array.isArray(s.projectMemory)
            && typeof (s.projectMemory as { autoInjectTopK?: unknown }).autoInjectTopK === "number"
              ? (s.projectMemory as { autoInjectTopK: number }).autoInjectTopK
              : prev.projectMemoryTopK,
          advisorEnabled: typeof s.advisorEnabled === "boolean" ? s.advisorEnabled : prev.advisorEnabled,
        }));
        if (s.leanMode && typeof s.leanMode === "object" && !Array.isArray(s.leanMode)) {
          const lm = s.leanMode as Partial<LeanModeSettings>;
          setLeanMode((prev) => ({
            enabled: typeof lm.enabled === "boolean" ? lm.enabled : prev.enabled,
            intensity:
              lm.intensity === "soft" || lm.intensity === "review" || lm.intensity === "hard"
                ? lm.intensity
                : prev.intensity,
          }));
        }
        setAdvisorModelRef(
          typeof s.advisorModel === "object" && s.advisorModel && !Array.isArray(s.advisorModel)
            && typeof (s.advisorModel as { provider?: string }).provider === "string"
            && typeof (s.advisorModel as { modelId?: string }).modelId === "string"
            ? `${(s.advisorModel as { provider: string }).provider}/${(s.advisorModel as { modelId: string }).modelId}`
            : "",
        );
        if (typeof s.terminalFont === "string") {
          try { localStorage.setItem("pi-terminal-font", s.terminalFont); } catch { /* ignore */ }
        }
        if (typeof s.soundEnabled === "boolean") {
          try { localStorage.setItem("pi-sound-enabled", String(s.soundEnabled)); } catch { /* ignore */ }
        }

      };

      // force only after a models mutation (modelsCatalogKey > 0) so disabled/
      // enabled models appear immediately in agent role dropdowns without Ctrl+R.
      fetchWebSettingsWithModels(cwd, {
        force: modelsCatalogKey > 0,
        onSettings: (settings) => {
          applySettingsPayload({ settings });
          if (!cancelled) setLoadingModels(false);
        },
      })
        .then((data) => {
          if (cancelled) return;
          setModels(data.models);
        })
        .catch((error) => {
          if (cancelled) return;
          setSaveError(error instanceof Error ? error.message : String(error));
          setModels([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingModels(false);
        });
      return () => {
        cancelled = true;
      };
    }, [applyModelSettings, cwd, modelsCatalogKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/app-update");
        const data = await res.json() as { currentVersion?: string };
        if (!cancelled && data.currentVersion) setCurrentVersion(data.currentVersion);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveModelPref = useCallback(async (key: "titleModel" | "commitModel", value: string) => {
    setSavingKey(key);
    setSaveError(null);
    if (key === "titleModel") setTitleModelRef(value);
    else setCommitModelRef(value);
    try {
      const settings = await saveWebSettings({ [key]: value || null });
      setTitleModelRef(settings?.titleModelRef ?? (key === "titleModel" ? value : titleModelRef));
      setCommitModelRef(settings?.commitModelRef ?? (key === "commitModel" ? value : commitModelRef));
      if (settings) applyModelSettings(settings);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  }, [applyModelSettings, commitModelRef, titleModelRef]);

  const saveRoleModel = useCallback(async (
    role: "default" | "smol" | "plan",
    value: string,
  ) => {
    const key = role === "default" ? "roleDefault" : role === "smol" ? "roleSmol" : "rolePlan";
    setSavingKey(key);
    setSaveError(null);
    if (role === "default") setRoleDefaultRef(value);
    else if (role === "smol") setRoleSmolRef(value);
    else setRolePlanRef(value);
    try {
      const settings = await saveWebSettings({ modelRole: role, modelRoleRef: value || null });
      setRoleDefaultRef(settings?.modelRolesRefs?.default ?? (role === "default" ? value : roleDefaultRef));
      setRoleSmolRef(settings?.modelRolesRefs?.smol ?? (role === "smol" ? value : roleSmolRef));
      setRolePlanRef(settings?.modelRolesRefs?.plan ?? (role === "plan" ? value : rolePlanRef));
      if (settings) applyModelSettings(settings);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  }, [applyModelSettings, roleDefaultRef, rolePlanRef, roleSmolRef]);

  const patchPref = useCallback(async (patch: Record<string, unknown>, opts?: { restart?: boolean }) => {
    setSaveError(null);
    setPrefs((prev) => ({ ...prev, ...patch } as typeof prev));
    try {
      const settings = await saveWebSettings(patch);
      if (settings) applyModelSettings(settings);
      if (opts?.restart) setRestartHint(true);
      if (typeof patch.soundEnabled === "boolean") {
        try { localStorage.setItem("pi-sound-enabled", String(patch.soundEnabled)); } catch { /* ignore */ }
      }
      if (typeof patch.terminalFont === "string") {
        try { localStorage.setItem("pi-terminal-font", patch.terminalFont); } catch { /* ignore */ }
      }
      // Live appearance
      const appearancePatch: Record<string, unknown> = {};
      for (const key of [
        "themeMode", "uiFontSize", "codeThemeLight", "codeThemeDark",
        "showCodeLineNumbers", "wrapCodeLines", "codeFontSize",
      ] as const) {
        if (key in patch) appearancePatch[key] = patch[key];
      }
      if (Object.keys(appearancePatch).length > 0) {
        setAppearanceSnapshot(appearancePatch as Parameters<typeof setAppearanceSnapshot>[0]);
        try {
          localStorage.setItem("pi-appearance", JSON.stringify({
            ...appearance,
            ...appearancePatch,
          }));
        } catch { /* ignore */ }
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, [appearance, applyModelSettings]);

  // Sync About panel with the shared store (AppShell owns background auto-check).
  useEffect(() => {
    const info = getAppUpdateInfo();
    if (info) {
      setUpdateStatus({
        kind: "available",
        version: info.latestVersion,
        releaseUrl: info.releaseUrl,
      });
      if (info.currentVersion) setCurrentVersion(info.currentVersion);
    }
    return subscribeAppUpdate(() => {
      const next = getAppUpdateInfo();
      if (next) {
        setUpdateStatus({
          kind: "available",
          version: next.latestVersion,
          releaseUrl: next.releaseUrl,
        });
        if (next.currentVersion) setCurrentVersion(next.currentVersion);
      }
    });
  }, []);

  const checkForAppUpdate = useCallback(async () => {
    setUpdateChecking(true);
    setUpdateStatus({ kind: "idle" });
    try {
      const res = await apiFetch("/api/app-update", { method: "POST" });
      const data = await res.json() as {
        currentVersion?: string;
        latestVersion?: string | null;
        updateAvailable?: boolean;
        releaseUrl?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.currentVersion) setCurrentVersion(data.currentVersion);
      if (data.message === "no_releases") {
        setAppUpdateInfo(null);
        setUpdateStatus({ kind: "empty" });
        return;
      }
      if (data.updateAvailable && data.latestVersion && data.releaseUrl) {
        setAppUpdateInfo({
          currentVersion: data.currentVersion ?? "",
          latestVersion: data.latestVersion,
          releaseUrl: data.releaseUrl,
          checkedAt: Date.now(),
        });
        setUpdateStatus({
          kind: "available",
          version: data.latestVersion,
          releaseUrl: data.releaseUrl,
        });
        window.open(data.releaseUrl, "_blank", "noopener,noreferrer");
        return;
      }
      setAppUpdateInfo(null);
      setUpdateStatus({ kind: "latest" });
    } catch (error) {
      setUpdateStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setUpdateChecking(false);
    }
  }, []);

  type NavItem = {
    id: SettingsSection;
    label: string;
    disabled?: boolean;
    title?: string;
  };

  // Grouped so app chrome, agent prefs, and integrations stay distinct.
  const navGroups: Array<{ label: string; items: NavItem[] }> = [
    {
      label: t("settings.navGroupApp"),
      items: [
        { id: "general", label: t("settings.general") },
        { id: "appearance", label: t("settings.appearance") },
        { id: "usage", label: t("settings.usage") },
      ],
    },
    {
      label: t("settings.navGroupAgent"),
      items: [
        { id: "agent", label: t("settings.agent") },
        { id: "memory", label: t("settings.memory") },
        { id: "permissions", label: t("settings.permissions") },
      ],
    },
    {
      label: t("settings.navGroupIntegrations"),
      items: [
        { id: "accounts", label: t("settings.accounts") },
        { id: "models", label: t("settings.models") },
        {
          id: "plugins",
          label: t("settings.plugins"),
          title: skillsDisabled ? t("settings.skillsNeedCwd") : undefined,
        },
        { id: "tools", label: t("settings.lsp") },
      ],
    },
  ];

  const loadLspHealth = useCallback(async () => {
    setLspLoading(true);
    setLspError(null);
    try {
      const params = new URLSearchParams();
      if (cwd) params.set("cwd", cwd);
      const res = await apiFetch(`/api/lsp?${params.toString()}`);
      const data = await res.json() as {
        ok?: boolean;
        error?: string;
        servers?: LspServerRow[];
        availableCount?: number;
        total?: number;
        builtinNote?: string;
      };
      if (!res.ok || data.ok === false) throw new Error(data.error ?? `HTTP ${res.status}`);
      setLspServers(Array.isArray(data.servers) ? data.servers : []);
      setLspMeta({
        availableCount: data.availableCount ?? 0,
        total: data.total ?? 0,
        builtinNote: data.builtinNote,
      });
    } catch (error) {
      setLspError(error instanceof Error ? error.message : String(error));
    } finally {
      setLspLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    if (section === "tools") void loadLspHealth();
  }, [section, loadLspHealth]);

  // Warm usage aggregate while the user is still on other settings tabs.
  useEffect(() => {
    prefetchUsage(30);
  }, []);

  // Avoid stale scroll when switching between long form pages and dual-pane panels.
  useEffect(() => {
    const main = document.querySelector(".settings-page-main");
    if (main instanceof HTMLElement) main.scrollTop = 0;
  }, [section]);

  const saveErrorBlock = saveError ? (
    <div style={{ marginTop: 10, fontSize: 12, color: "var(--destructive)", lineHeight: 1.4 }}>
      {saveError}
    </div>
  ) : null;

  const generalPanel = (
    <GeneralSettingsPanel
      prefs={prefs}
      onTerminalFont={(value) => setPrefs((p) => ({ ...p, terminalFont: value }))}
      patchPref={patchPref}
      isDesktop={isDesktop}
      restartHint={restartHint}
      currentVersion={currentVersion}
      updateStatus={updateStatus}
      updateChecking={updateChecking}
      checkForAppUpdate={checkForAppUpdate}
      saveErrorBlock={saveErrorBlock}
    />
  );

  const agentModelsPanel = (
    <AgentModelsSettingsPanel
      models={models}
      loadingModels={loadingModels}
      savingKey={savingKey}
      roleDefaultRef={roleDefaultRef}
      roleSmolRef={roleSmolRef}
      rolePlanRef={rolePlanRef}
      roleDefaultThinking={roleDefaultThinking}
      roleSmolThinking={roleSmolThinking}
      rolePlanThinking={rolePlanThinking}
      titleModelRef={titleModelRef}
      commitModelRef={commitModelRef}
      titleModelThinking={titleModelThinking}
      commitModelThinking={commitModelThinking}
      saveModelPref={saveModelPref}
      saveModelThinking={saveModelThinking}
      saveRoleModel={saveRoleModel}
      saveRoleThinking={saveRoleThinking}
      saveErrorBlock={saveErrorBlock}
    />
  );


   const agentBehaviorPanel = (
     <AgentBehaviorSettings
       prefs={prefs}
       onLocal={(patch) => setPrefs((prev) => ({ ...prev, ...patch }))}
       patchPref={patchPref}
     />
   );

  const memoryPanel = (
    <MemorySettingsPanel
      prefs={prefs}
      setPrefs={setPrefs}
      patchPref={patchPref}
      cwd={cwd}
      setSaveError={setSaveError}
      saveErrorBlock={saveErrorBlock}
    />
  );

  const agentAdvisorPanel = (
    <AdvisorSettingsPanel
      advisorEnabled={prefs.advisorEnabled}
      advisorModelRef={advisorModelRef}
      advisorModelThinking={advisorModelThinking}
      models={models}
      loadingModels={loadingModels}
      savingKey={savingKey}
      setAdvisorEnabled={(next) => setPrefs((p) => ({ ...p, advisorEnabled: next }))}
      setAdvisorModelRef={setAdvisorModelRef}
      setSavingKey={setSavingKey}
      patchPref={patchPref}
      saveModelThinking={saveModelThinking}
      leanMode={leanMode}
      onLeanPatch={(partial) => {
        setLeanMode((prev) => {
          const next = { ...prev, ...partial };
          void patchPref({ leanMode: next });
          return next;
        });
      }}
    />
  );


  const appearancePanel = (
    <AppearanceSettingsPanel
      themeMode={themeMode}
      setThemeMode={setThemeMode}
      isDark={isDark}
      isMobile={isMobile}
      appearance={appearance}
      patchPref={patchPref}
    />
  );

  // Critical layout is inlined so a CSS-load race cannot leave settings
  // flowing through the main shell (what looked like a "CSS collapse").
  const rootStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 1200,
    // Warm-mounted hidden after first use / idle warmup: stays in the React
    // tree (state + fetched data survive) but paints nothing.
    display: visible ? "flex" : "none",
    flexDirection: "column",
    background: "var(--bg)",
    color: "var(--text)",
  };
  const topbarStyle: CSSProperties = {
    display: "flex",
    alignItems: "stretch",
    flexShrink: 0,
    height: "var(--titlebar-height)",
    minHeight: "var(--titlebar-height)",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-panel)",
    overflow: "hidden",
    minWidth: 0,
  };
  const bodyStyle: CSSProperties = {
    display: "flex",
    flex: 1,
    minHeight: 0,
    flexDirection: isMobile ? "column" : "row",
  };
  const navStyle: CSSProperties = isMobile
    ? {
        width: "100%",
        flexShrink: 0,
        display: "flex",
        flexDirection: "row",
        overflowX: "auto",
        overflowY: "hidden",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
      }
    : {
        width: "var(--sidebar-width)",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
        borderRight: "1px solid var(--border)",
        background: "var(--bg-panel)",
        padding: "8px 0",
      };
  // Content pages scroll here; models keeps its own dual-pane overflow.
  const mainScrolls = section !== "models";

  const toolsPanel = (
    <ToolsSettingsPanel
      lspServers={lspServers}
      lspMeta={lspMeta}
      lspLoading={lspLoading}
      lspError={lspError}
      lspCopiedId={lspCopiedId}
      loadLspHealth={loadLspHealth}
      setLspCopiedId={setLspCopiedId}
    />
  );

  const mainStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: mainScrolls ? "auto" : "hidden",
    background: "var(--bg)",
  };

  const page = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.title")}
      className="settings-page"
      style={rootStyle}
    >
      <div className="settings-page-topbar app-topbar titlebar-drag desktop-top-chrome" style={topbarStyle}>
        <div className="traffic-lights-spacer titlebar-drag" aria-hidden />
        <div className="chrome-cluster titlebar-no-drag" style={{ flexShrink: 0, display: "flex", alignItems: "stretch", height: "100%" }}>
          <button
            type="button"
            className="chrome-btn"
            onClick={onClose}
            style={{
              borderRadius: 0,
              borderRight: "1px solid var(--border)",
              padding: "0 12px",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Icon icon={ChevronLeft} size={14} />
            <span>{t("settings.backToWorkspace")}</span>
          </button>
        </div>
        <div
          className="settings-page-topbar-title titlebar-no-drag"
          style={{
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "var(--text)",
            whiteSpace: "nowrap",
            borderRight: "1px solid var(--border)",
          }}
        >
          {t("settings.title")}
        </div>
        <div className="titlebar-drag" style={{ flex: 1, minWidth: 0 }} />
        <WindowControls />
      </div>

      <div className={`settings-page-body${isMobile ? " is-mobile" : ""}`} style={bodyStyle}>
        <nav
          aria-label={t("settings.title")}
          className={`settings-page-nav${isMobile ? " is-mobile" : ""}`}
          style={navStyle}
        >
          {navGroups.map((group, groupIndex) => (
            <div key={group.label} className="settings-page-nav-group">
              {!isMobile && (
                <div
                  className="settings-page-nav-label"
                  style={groupIndex > 0 ? { paddingTop: 14 } : undefined}
                >
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`settings-page-nav-item${active ? " is-active" : ""}`}
                    disabled={item.disabled}
                    title={item.title}
                    onMouseEnter={() => {
                      if (item.id === "usage") prefetchUsage(30);
                    }}
                    onClick={() => setSection(item.id)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <main className={`settings-page-main${mainScrolls ? " is-scroll" : ""}`} style={mainStyle}>
          {section === "general" && (
            <div className="settings-page-general">
              {generalPanel}
            </div>
          )}
          {section === "agent" && (
            <div className="settings-page-general">
              <SettingsPageHeading title={t("settings.agent")} />
              {agentModelsPanel}
              {agentBehaviorPanel}
              {agentAdvisorPanel}
            </div>
          )}
          {section === "memory" && (
            <div className="settings-page-general">
              <SettingsPageHeading title={t("settings.memory")} />
              {memoryPanel}
            </div>
          )}
          {section === "permissions" && <PermissionsSettingsPanel />}
          {section === "usage" && <UsagePanel />}
          {section === "accounts" && <AccountsSettingsPanel />}
          {section === "appearance" && appearancePanel}
          {section === "models" && (
            <ModelsConfig
              embedded
              onClose={() => {
                // Do not call onModelsChanged here — browsing Models must not
                // force-refresh the chat catalog / feel like a session reload.
              }}
              onModelsChanged={() => {
                // Silent refresh: chat catalog (parent) + this page's agent model lists.
                onModelsChanged?.();
                setModelsCatalogKey((k) => k + 1);
              }}
            />
          )}
          {(section === "plugins" || section === "skills" || section === "mcp") && (
            <PluginsSettings
              cwd={cwd}
              initialTab={initialSection === "mcp" ? "mcp" : "skills"}
              onClose={onClose}
              onTrySkill={onTrySkill}
            />
          )}
          {section === "tools" && toolsPanel}
        </main>
      </div>
    </div>
  );

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(page, document.body);
}
