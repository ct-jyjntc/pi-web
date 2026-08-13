/**
 * Quiet monochrome skill tile — accent mix is hashed from the name.
 */

import { Boxes } from "lucide-react";
import { Icon } from "../Icon";

function nameMix(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return 8 + (hash % 12);
}

export function SkillIcon({
  name,
  size = 36,
  variant = "tile",
}: {
  name: string;
  size?: number;
  variant?: "tile" | "circle";
}) {
  const mix = nameMix(name);
  const iconSize = size < 32 ? 13 : 16;
  return (
    <span
      className={`skill-icon${variant === "circle" ? " is-circle" : ""}`}
      style={{
        width: size,
        height: size,
        background: `color-mix(in oklab, var(--accent) ${mix}%, var(--bg-subtle))`,
      }}
      aria-hidden
    >
      <Icon icon={Boxes} size={iconSize} strokeWidth={1.8} />
    </span>
  );
}
