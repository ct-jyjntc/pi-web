/**
 * Installed-skill catalog: search, personal/project tabs, settings rows.
 */

"use client";

import { Plus, Search } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useLocale } from "@/hooks/useLocale";
import type { SkillInfo as Skill, SkillUpdateResult } from "@/lib/api-types";
import { displaySkillName } from "@/lib/skill-invoke";
import { Icon } from "../Icon";
import { SettingsToggle } from "../SettingsToggle";
import { SettingsGroup, SettingsPageHeading, SettingsRow } from "../settings/settings-ui";
import { skillScope, updateKey } from "./skill-helpers";
import { SkillIcon } from "./SkillIcon";

export type SkillCatalogTab = "all" | "personal" | "project";

export function SkillCatalog({
  skills,
  loading,
  error,
  query,
  onQueryChange,
  tab,
  onTabChange,
  addMode,
  onAddMode,
  hideHeading = false,
  updateStatuses,
  checkingAll,
  canCheckUpdates,
  onCheckUpdates,
  onSelect,
  onToggle,
  toggling,
  children,
}: {
  skills: Skill[];
  loading: boolean;
  error: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  tab: SkillCatalogTab;
  onTabChange: (tab: SkillCatalogTab) => void;
  addMode: boolean;
  onAddMode: (next: boolean) => void;
  hideHeading?: boolean;
  updateStatuses: Record<string, SkillUpdateResult>;
  checkingAll: boolean;
  canCheckUpdates: boolean;
  onCheckUpdates: () => void;
  onSelect: (skill: Skill) => void;
  onToggle?: (skill: Skill) => void;
  toggling?: ReadonlySet<string>;
  children?: ReactNode;
}) {
  const { t } = useLocale();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return skills.filter((skill) => {
      const scope = skillScope(skill);
      if (tab === "personal" && scope !== "global") return false;
      if (tab === "project" && scope !== "project") return false;
      if (!needle) return true;
      return (
        skill.name.toLowerCase().includes(needle)
        || skill.description.toLowerCase().includes(needle)
      );
    });
  }, [query, skills, tab]);

  const scopeLabel = (skill: Skill) => {
    const scope = skillScope(skill);
    if (scope === "global") return t("skills.tabPersonal");
    if (scope === "project") return t("skills.tabProject");
    return t("skills.groupPath");
  };

  return (
    <div className={hideHeading ? "plugin-catalog" : "settings-page-general plugin-catalog"}>
      {!hideHeading && (
        <SettingsPageHeading
          title={t("modal.skills")}
          description={t("skills.subtitle")}
          action={addMode ? undefined : (
            <div className="usage-header-actions">
              <button
                type="button"
                className="btn-primary btn-compact"
                onClick={() => onAddMode(true)}
              >
                <Icon icon={Plus} size={12} strokeWidth={2} />
                {t("skills.addSkill")}
              </button>
              {canCheckUpdates && (
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  onClick={onCheckUpdates}
                  disabled={checkingAll}
                >
                  {checkingAll ? t("skills.checking") : t("skills.checkUpdates")}
                </button>
              )}
            </div>
          )}
        />
      )}

      {addMode ? children : (
        <>
          <label className="skill-catalog-search" style={{ marginBottom: 16 }}>
            <Icon icon={Search} size={14} strokeWidth={1.8} />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={t("skills.searchInstalled")}
              className="input-base"
              type="search"
            />
          </label>

          <SettingsGroup
            title={hideHeading ? undefined : (tab === "all" ? t("skills.installed") : tab === "personal" ? t("skills.tabPersonal") : t("skills.tabProject"))}
            action={hideHeading ? undefined : (
              <div className="settings-segmented" style={{ minWidth: 0 }}>
                {([
                  ["all", t("skills.tabAll")],
                  ["personal", t("skills.tabPersonal")],
                  ["project", t("skills.tabProject")],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`chrome-btn${tab === id ? " is-active" : ""}`}
                    aria-pressed={tab === id}
                    onClick={() => onTabChange(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          >
            {loading ? (
              <div className="settings-card-empty">{t("modal.loading")}</div>
            ) : error ? (
              <div className="settings-card-empty" style={{ color: "var(--destructive)" }}>{error}</div>
            ) : filtered.length === 0 ? (
              <div className="settings-card-empty">{t("skills.noSkills")}</div>
            ) : (
              filtered.map((skill) => {
                const key = updateKey(skill);
                const updateAvailable = key ? updateStatuses[key]?.state === "update-available" : false;
                return (
                  <SettingsRow
                    key={skill.filePath}
                    title={(
                      <span className="plugin-row-title">
                        <SkillIcon name={skill.name} size={22} variant="circle" />
                        <span>{displaySkillName(skill.name) + (updateAvailable ? " ↑" : "")}</span>
                      </span>
                    )}
                    description={skill.description}
                    onClick={() => onSelect(skill)}
                    action={
                      <span className="plugin-row-meta">
                        <span className="skill-scope-chip">{scopeLabel(skill)}</span>
                        {onToggle ? (
                          <SettingsToggle
                            enabled={!skill.disableModelInvocation}
                            loading={toggling?.has(skill.filePath) ?? false}
                            title={
                              skill.disableModelInvocation
                                ? t("skills.hiddenFromModel")
                                : t("skills.visibleToModel")
                            }
                            onChange={() => onToggle(skill)}
                          />
                        ) : null}
                      </span>
                    }
                  />
                );
              })
            )}
          </SettingsGroup>
        </>
      )}
    </div>
  );
}
