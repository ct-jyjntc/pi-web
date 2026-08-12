/**
 * Overlay for one installed skill: body preview, enable toggle, Try now.
 */

"use client";

import { useEffect, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { apiFetch } from "@/lib/api-transport";
import type { SkillInfo as Skill, SkillUpdateResult } from "@/lib/api-types";
import { displaySkillName } from "@/lib/skill-invoke";
import { Icon } from "../Icon";
import { MarkdownBody } from "../MarkdownBody";
import { SettingsToggle } from "../SettingsToggle";
import { SkillIcon } from "./SkillIcon";

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="skill-detail-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="skill-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="skill-detail-top">
          <SkillIcon name={skill.name} size={40} />
          <div className="skill-detail-top-actions">
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
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label={t("common.close")}
            >
              <Icon icon={X} size={14} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div className="skill-detail-heading">
          <h2 id="skill-detail-title">{displaySkillName(skill.name)}</h2>
          <span className="skill-detail-badge">{t("skills.badge")}</span>
        </div>
        <p className="skill-detail-lede">
          {skill.description}
          <span className="skill-detail-trigger">
            {t("skills.triggerName", { name: skill.name })}
          </span>
        </p>
        {saveError && <div className="skill-detail-error">{saveError}</div>}
        {updateStatus?.state === "update-available" && (
          <div className="skill-detail-version">
            <button
              type="button"
              className="skill-catalog-text-btn"
              onClick={onUpdate}
              disabled={updating || checkingUpdate}
            >
              {updating ? t("modal.updating") : t("modal.update")}
            </button>
          </div>
        )}
        {updateError && <div className="skill-detail-error">{updateError}</div>}

        <div className="skill-detail-body">
          {bodyLoading && <div className="skill-detail-muted">{t("common.loading")}</div>}
          {bodyError && <div className="skill-detail-error">{bodyError}</div>}
          {!bodyLoading && !bodyError && skillBody !== null && (
            skillBody.trim()
              ? (
                <div className="settings-skill-body skill-detail-markdown">
                  <MarkdownBody>{skillBody}</MarkdownBody>
                </div>
              )
              : <div className="skill-detail-muted">{t("skills.skillMdEmpty")}</div>
          )}
        </div>

        {onTryNow && (
          <div className="skill-detail-footer">
            <button
              type="button"
              className="btn-primary"
              onClick={() => onTryNow(skill)}
            >
              <Icon icon={MessageSquare} size={13} strokeWidth={2} />
              {t("skills.tryNow")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
