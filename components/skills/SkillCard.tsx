/**
 * One installed-skill row in the catalog grid.
 */

import { Check } from "lucide-react";
import type { SkillInfo as Skill } from "@/lib/api-types";
import { displaySkillName } from "@/lib/skill-invoke";
import { Icon } from "../Icon";
import { SkillIcon } from "./SkillIcon";

export function SkillCard({
  skill,
  updateAvailable,
  onSelect,
}: {
  skill: Skill;
  updateAvailable?: boolean;
  onSelect: (skill: Skill) => void;
}) {
  const enabled = !skill.disableModelInvocation;
  return (
    <button
      type="button"
      className={`skill-card${enabled ? "" : " is-disabled"}`}
      onClick={() => onSelect(skill)}
      style={{ minWidth: 0, maxWidth: "100%", overflow: "hidden" }}
    >
      <SkillIcon name={skill.name} />
      <span className="skill-card-copy" style={{ minWidth: 0, overflow: "hidden" }}>
        <span className="skill-card-title">
          {displaySkillName(skill.name)}
          {updateAvailable && (
            <span className="skill-card-update" title="↑">↑</span>
          )}
        </span>
        <span className="skill-card-desc">{skill.description}</span>
      </span>
      {enabled && (
        <span className="skill-card-check" aria-hidden>
          <Icon icon={Check} size={14} strokeWidth={2} />
        </span>
      )}
    </button>
  );
}
