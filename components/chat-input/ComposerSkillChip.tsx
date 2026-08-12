/**
 * Composer chip for a skill attached via Try now.
 */

"use client";

import { X } from "lucide-react";
import { displaySkillName } from "@/lib/skill-invoke";
import { Icon } from "../Icon";
import { SkillIcon } from "../skills/SkillIcon";

export function ComposerSkillChip({
  name,
  removeLabel,
  onRemove,
}: {
  name: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <div className="composer-skill-chip">
      <SkillIcon name={name} size={18} />
      <span className="composer-skill-chip-label">{displaySkillName(name)}</span>
      <button
        type="button"
        className="composer-skill-chip-remove"
        onClick={onRemove}
        aria-label={removeLabel}
      >
        <Icon icon={X} size={10} strokeWidth={2} />
      </button>
    </div>
  );
}
