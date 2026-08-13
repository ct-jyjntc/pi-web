/**
 * Centered skill detail — same CenteredDialog / menu-card chrome as YOLO and inspect.
 */

"use client";

import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { apiFetch } from "@/lib/api-transport";
import type { SkillInfo as Skill, SkillUpdateResult } from "@/lib/api-types";
import { displaySkillName } from "@/lib/skill-invoke";
import { Icon } from "../Icon";
import { MarkdownBody } from "../MarkdownBody";
import { SettingsToggle } from "../SettingsToggle";
import { CenteredDialog } from "../CenteredDialog";
import { SkillIcon } from "./SkillIcon";
import { previewSkillMarkdown } from "./skill-helpers";

export function SkillDetailModal({
  skill,
  onClose,
  onToggle,
  toggling,
  saveError,
  updateStatus,
  checkingUpdate,
  updating,
  updateError,
  onUpdate,
  onTryNow,
}: {
  skill: Skill;
  onClose: () => void;
  onToggle: (skill: Skill) => void;
  toggling: boolean;
  saveError: string | null;
  updateStatus?: SkillUpdateResult;
  checkingUpdate: boolean;
  updating: boolean;
  updateError: string | null;
  onUpdate: () => void;
  onTryNow?: (skill: Skill) => void;
}) {
  const { t } = useLocale();
  const enabled = !skill.disableModelInvocation;
  const [skillBody, setSkillBody] = useState<string | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSkillBody(null);
    setBodyError(null);
    setBodyLoading(true);
    apiFetch(`/api/skills/content?path=${encodeURIComponent(skill.filePath)}`)
      .then(async (res) => {
        const data = await res.json() as { body?: string; error?: string };
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (!cancelled) setSkillBody(data.body ?? "");
      })
      .catch((error) => {
        if (!cancelled) setBodyError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setBodyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skill.filePath]);

  const preview = skillBody != null ? previewSkillMarkdown(skillBody) : "";

  return (
    <CenteredDialog width={520} zIndex={1300} labelledBy="skill-detail-title" onClose={onClose}>
      <div style={{ padding: "14px 14px 10px" }}>
        <div className="skill-detail-head">
          <SkillIcon name={skill.name} size={22} variant="circle" />
          <div id="skill-detail-title" className="skill-detail-title">
            {displaySkillName(skill.name)}
          </div>
          <SettingsToggle
            enabled={enabled}
            loading={toggling}
            title={
              enabled
                ? t("skills.visibleToModel")
                : t("skills.hiddenFromModel")
            }
            onChange={() => onToggle(skill)}
          />
        </div>
        <p className="skill-detail-lede">{skill.description}</p>
        <div className="skill-detail-trigger">
          {t("skills.triggerName", { name: skill.name })}
        </div>
        {saveError && <div className="skill-detail-error">{saveError}</div>}
        {updateError && <div className="skill-detail-error">{updateError}</div>}
      </div>

      <div className="ext-dialog-scroll skill-detail-md">
        {bodyLoading && <div className="skill-detail-muted">{t("common.loading")}</div>}
        {bodyError && <div className="skill-detail-error">{bodyError}</div>}
        {!bodyLoading && !bodyError && skillBody !== null && (
          preview
            ? <MarkdownBody>{preview}</MarkdownBody>
            : <div className="skill-detail-muted">{t("skills.skillMdEmpty")}</div>
        )}
      </div>

      <div className="ext-dialog-footer">
        <div style={{ height: 1, background: "var(--border)" }} />
        <div style={{ padding: 4 }}>
          {onTryNow && (
            <button type="button" className="menu-row" onClick={() => onTryNow(skill)}>
              <Icon icon={MessageSquare} size={13} strokeWidth={2} />
              {t("skills.tryNow")}
            </button>
          )}
          {updateStatus?.state === "update-available" && (
            <button
              type="button"
              className="menu-row"
              onClick={onUpdate}
              disabled={updating || checkingUpdate}
            >
              {updating ? t("modal.updating") : t("modal.update")}
            </button>
          )}
          <button type="button" className="menu-row" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </CenteredDialog>
  );
}
