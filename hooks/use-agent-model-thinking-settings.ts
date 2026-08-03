// Owns Agent model thinking-level state and persistence for SettingsPage.
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { ThinkingLevelPref } from "@/lib/web-settings";
import { saveWebSettings, type WebSettingsData } from "@/lib/web-settings-store";

export type AgentModelSaveKey = "titleModel" | "commitModel" | "advisorModel" | "roleDefault" | "roleSmol" | "rolePlan";
export type AgentModelRole = "default" | "smol" | "plan";
export type AgentModelPreference = "titleModel" | "commitModel" | "advisorModel";

type UseAgentModelThinkingSettingsOptions = {
  setSavingKey: Dispatch<SetStateAction<AgentModelSaveKey | null>>;
  setSaveError: Dispatch<SetStateAction<string | null>>;
};

export function useAgentModelThinkingSettings({
  setSavingKey,
  setSaveError,
}: UseAgentModelThinkingSettingsOptions) {
  const [titleModelThinking, setTitleModelThinking] = useState<ThinkingLevelPref | null>(null);
  const [commitModelThinking, setCommitModelThinking] = useState<ThinkingLevelPref | null>(null);
  const [advisorModelThinking, setAdvisorModelThinking] = useState<ThinkingLevelPref | null>(null);
  const [roleDefaultThinking, setRoleDefaultThinking] = useState<ThinkingLevelPref | null>(null);
  const [roleSmolThinking, setRoleSmolThinking] = useState<ThinkingLevelPref | null>(null);
  const [rolePlanThinking, setRolePlanThinking] = useState<ThinkingLevelPref | null>(null);

  const applySettings = useCallback((settings: WebSettingsData | null) => {
    setTitleModelThinking(settings?.titleModel?.thinkingLevel ?? null);
    setCommitModelThinking(settings?.commitModel?.thinkingLevel ?? null);
    setAdvisorModelThinking(settings?.advisorModel?.thinkingLevel ?? null);
    setRoleDefaultThinking(settings?.modelRoles?.default?.thinkingLevel ?? null);
    setRoleSmolThinking(settings?.modelRoles?.smol?.thinkingLevel ?? null);
    setRolePlanThinking(settings?.modelRoles?.plan?.thinkingLevel ?? null);
  }, []);

  const saveModelThinking = useCallback(async (
    key: AgentModelPreference,
    level: ThinkingLevelPref | null,
  ) => {
    const nextLevel = level ?? "off";
    setSavingKey(key);
    setSaveError(null);
    if (key === "titleModel") setTitleModelThinking(nextLevel);
    else if (key === "commitModel") setCommitModelThinking(nextLevel);
    else setAdvisorModelThinking(nextLevel);
    try {
      const settings = await saveWebSettings({ modelPref: key, modelPrefThinking: nextLevel });
      const savedLevel = settings?.[key]?.thinkingLevel ?? nextLevel;
      if (key === "titleModel") setTitleModelThinking(savedLevel);
      else if (key === "commitModel") setCommitModelThinking(savedLevel);
      else setAdvisorModelThinking(savedLevel);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  }, [setSaveError, setSavingKey]);

  const saveRoleThinking = useCallback(async (
    role: AgentModelRole,
    level: ThinkingLevelPref | null,
  ) => {
    const key = role === "default" ? "roleDefault" : role === "smol" ? "roleSmol" : "rolePlan";
    const nextLevel = level ?? "off";
    setSavingKey(key);
    setSaveError(null);
    if (role === "default") setRoleDefaultThinking(nextLevel);
    else if (role === "smol") setRoleSmolThinking(nextLevel);
    else setRolePlanThinking(nextLevel);
    try {
      const settings = await saveWebSettings({ modelRole: role, modelRoleThinking: nextLevel });
      const savedLevel = settings?.modelRoles?.[role]?.thinkingLevel ?? nextLevel;
      if (role === "default") setRoleDefaultThinking(savedLevel);
      else if (role === "smol") setRoleSmolThinking(savedLevel);
      else setRolePlanThinking(savedLevel);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  }, [setSaveError, setSavingKey]);

  return {
    titleModelThinking,
    commitModelThinking,
    advisorModelThinking,
    roleDefaultThinking,
    roleSmolThinking,
    rolePlanThinking,
    applySettings,
    saveModelThinking,
    saveRoleThinking,
  };
}
