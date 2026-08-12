/**
 * Installed-skill catalog: search, personal/project tabs, two-column cards.
 */

"use client";

import { Plus, Search } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useLocale } from "@/hooks/useLocale";
import type { SkillInfo as Skill, SkillUpdateResult } from "@/lib/api-types";
import { Icon } from "../Icon";
import { SkillCard } from "./SkillCard";
import { skillScope, updateKey } from "./skill-helpers";

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
  updateStatuses,
  checkingAll,
  canCheckUpdates,
  onCheckUpdates,
  onSelect,
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
  updateStatuses: Record<string, SkillUpdateResult>;
  checkingAll: boolean;
  canCheckUpdates: boolean;
  onCheckUpdates: () => void;
  onSelect: (skill: Skill) => void;
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

  return (
    <div className="skill-catalog">
      <header className="skill-catalog-header">
        <h1 className="skill-catalog-title">{t("modal.skills")}</h1>
        <p className="skill-catalog-lede">{t("skills.subtitle")}</p>
      </header>

      {addMode ? children : (
        <>
          <div className="skill-catalog-toolbar">
            <label className="skill-catalog-search">
              <Icon icon={Search} size={14} strokeWidth={1.8} />
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder={t("skills.searchInstalled")}
                className="input-base"
                type="search"
              />
            </label>
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

          <div className="skill-catalog-tabs" role="tablist" aria-label={t("modal.skills")}>
            {([
              ["all", t("skills.tabAll")],
              ["personal", t("skills.tabPersonal")],
              ["project", t("skills.tabProject")],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`skill-catalog-tab${tab === id ? " is-active" : ""}`}
                onClick={() => onTabChange(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="skill-catalog-section-title">
            {tab === "all" ? t("skills.installed") : tab === "personal" ? t("skills.tabPersonal") : t("skills.tabProject")}
          </div>

          {loading ? (
            <div className="skill-catalog-empty">{t("modal.loading")}</div>
          ) : error ? (
            <div className="skill-catalog-empty is-error">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="skill-catalog-empty">{t("skills.noSkills")}</div>
          ) : (
            <div
              className="skill-catalog-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "4px 28px",
                width: "100%",
              }}
            >
              {filtered.map((skill) => {
                const key = updateKey(skill);
                return (
                  <SkillCard
                    key={skill.filePath}
                    skill={skill}
                    updateAvailable={key ? updateStatuses[key]?.state === "update-available" : false}
                    onSelect={onSelect}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
