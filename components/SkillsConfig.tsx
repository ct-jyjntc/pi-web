"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale } from "@/hooks/useLocale";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ConfigPanelBackdrop, ConfigPanelShell } from "./ConfigPanelShell";
import type { SkillInfo as Skill, SkillUpdateResult } from "@/lib/api-types";
import { apiFetch } from "@/lib/api-transport";
import { AddSkillPanel } from "./skills/AddSkillPanel";
import { SkillCatalog, type SkillCatalogTab } from "./skills/SkillCatalog";
import { SkillDetailModal } from "./skills/SkillDetailModal";
import { updateKey } from "./skills/skill-helpers";

export function SkillsConfig({
  cwd,
  onClose,
  embedded = false,
  hideHeading = false,
  onTrySkill,
  onCountChange,
  onAddModeChange,
  addRequestKey = 0,
}: {
  cwd: string;
  onClose: () => void;
  /** When true, render as a full-height settings page panel (no modal chrome). */
  embedded?: boolean;
  hideHeading?: boolean;
  onTrySkill?: (skill: Skill) => void;
  onCountChange?: (n: number) => void;
  onAddModeChange?: (open: boolean) => void;
  addRequestKey?: number;
}) {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SkillCatalogTab>("all");
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, SkillUpdateResult>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [updatingSkill, setUpdatingSkill] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`);
      const d = (await res.json()) as { skills?: Skill[]; error?: string };
      if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
      setSkills(d.skills ?? []);
      return d.skills ?? [];
    } catch (e) {
      setError(String(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setUpdateStatuses({});
    setUpdateError(null);
    setSelected(null);
    setAddMode(false);
    void loadSkills();
  }, [cwd, loadSkills]);

  useEffect(() => {
    onCountChange?.(skills.length);
  }, [onCountChange, skills.length]);

  useEffect(() => {
    onAddModeChange?.(addMode);
  }, [addMode, onAddModeChange]);

  useEffect(() => () => onAddModeChange?.(false), [onAddModeChange]);

  useEffect(() => {
    if (addRequestKey > 0) setAddMode(true);
  }, [addRequestKey]);

  const checkForUpdates = useCallback(async (skill?: Skill) => {
    const targets = skill
      ? [skill]
      : skills.filter((item) => Boolean(item.install));
    const keys = targets
      .map(updateKey)
      .filter((key): key is string => Boolean(key));
    if (keys.length === 0) return;

    setUpdateError(null);
    setCheckingUpdates((current) => new Set([...current, ...keys]));
    if (!skill) setCheckingAll(true);
    try {
      const res = await apiFetch("/api/skills/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill?.install?.package,
          scope: skill?.install?.scope,
        }),
      });
      const data = (await res.json()) as {
        updates?: SkillUpdateResult[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUpdateStatuses((current) => {
        const next = { ...current };
        for (const update of data.updates ?? []) {
          next[`${update.scope}\0${update.package}`] = update;
        }
        return next;
      });
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingUpdates((current) => {
        const next = new Set(current);
        for (const key of keys) next.delete(key);
        return next;
      });
      if (!skill) setCheckingAll(false);
    }
  }, [cwd, skills]);

  const updateInstalledSkill = useCallback(async (skill: Skill) => {
    if (!skill.install) return;
    const key = updateKey(skill)!;
    setUpdatingSkill(key);
    setUpdateError(null);
    try {
      const res = await apiFetch("/api/skills/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill.install.package,
          scope: skill.install.scope,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        skill?: Skill;
        error?: string;
      };
      if (!res.ok || data.error || !data.success) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await loadSkills();
      const versionHash = data.skill?.install?.versionHash;
      setUpdateStatuses((current) => ({
        ...current,
        [key]: {
          package: skill.install!.package,
          scope: skill.install!.scope,
          state: "up-to-date",
          currentVersion: versionHash,
          latestVersion: versionHash,
        },
      }));
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdatingSkill(null);
    }
  }, [cwd, loadSkills]);

  const toggle = useCallback(async (skill: Skill) => {
    const next = !skill.disableModelInvocation;
    setToggling((s) => new Set(s).add(skill.filePath));
    setSaveError(null);
    try {
      const res = await apiFetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: skill.filePath,
          disableModelInvocation: next,
        }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setSaveError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setSkills((prev) =>
        prev.map((s) =>
          s.filePath === skill.filePath
            ? { ...s, disableModelInvocation: next }
            : s,
        ),
      );
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setToggling((s) => {
        const n = new Set(s);
        n.delete(skill.filePath);
        return n;
      });
    }
  }, []);

  const selectedSkill = skills.find((s) => s.filePath === selected) ?? null;

  const catalog = (
    <SkillCatalog
      skills={skills}
      loading={loading}
      error={error}
      query={query}
      onQueryChange={setQuery}
      tab={tab}
      onTabChange={setTab}
      addMode={addMode}
      onAddMode={setAddMode}
      hideHeading={hideHeading}
      updateStatuses={updateStatuses}
      checkingAll={checkingAll}
      canCheckUpdates={skills.some((skill) => Boolean(skill.install))}
      onCheckUpdates={() => void checkForUpdates()}
      onSelect={(skill) => {
        setSelected(skill.filePath);
        setSaveError(null);
      }}
      onToggle={toggle}
      toggling={toggling}
    >
      <AddSkillPanel
        cwd={cwd}
        onBack={() => setAddMode(false)}
        installedPackages={{
          global: new Set(
            skills
              .filter((skill) => skill.install?.scope === "global")
              .map((skill) => skill.install!.package),
          ),
          project: new Set(
            skills
              .filter((skill) => skill.install?.scope === "project")
              .map((skill) => skill.install!.package),
          ),
        }}
        onInstalled={() => {
          void loadSkills();
        }}
      />
    </SkillCatalog>
  );

  const detail = selectedSkill ? (
    <SkillDetailModal
      key={selectedSkill.filePath}
      skill={selectedSkill}
      onClose={() => setSelected(null)}
      onToggle={toggle}
      toggling={toggling.has(selectedSkill.filePath)}
      saveError={saveError}
      updateStatus={
        updateKey(selectedSkill)
          ? updateStatuses[updateKey(selectedSkill)!]
          : undefined
      }
      checkingUpdate={
        updateKey(selectedSkill)
          ? checkingUpdates.has(updateKey(selectedSkill)!)
          : false
      }
      updating={updatingSkill === updateKey(selectedSkill)}
      updateError={updateError}
      onUpdate={() => void updateInstalledSkill(selectedSkill)}
      onTryNow={onTrySkill ? (skill) => {
        setSelected(null);
        onTrySkill(skill);
      } : undefined}
    />
  ) : null;

  if (embedded) {
    return (
      <div className="settings-embedded skill-catalog-page">
        {catalog}
        {detail}
      </div>
    );
  }

  return (
    <ConfigPanelBackdrop onClose={onClose}>
      <ConfigPanelShell
        title={t("modal.skills")}
        onClose={onClose}
        closeAriaLabel={t("common.close")}
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 860,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "78vh",
          maxHeight: "calc(100dvh - 16px)",
        }}
      >
        <div className="modal-body skill-catalog-page" style={{ flex: 1, minHeight: 0 }}>
          {catalog}
        </div>
        {detail}
      </ConfigPanelShell>
    </ConfigPanelBackdrop>
  );
}
