"use client";

import type { LucideIcon, LucideProps } from "lucide-react";

/**
 * Quiet Console defaults for lucide icons.
 * Keep chrome dense: 10–16px optical size, restrained stroke.
 */
export const ICON_SIZE = {
  xs: 10,
  sm: 11,
  md: 12,
  lg: 13,
  xl: 14,
  "2xl": 16,
  "3xl": 18,
} as const;

export type IconSizeToken = keyof typeof ICON_SIZE;

export type IconProps = Omit<LucideProps, "ref" | "size"> & {
  icon: LucideIcon;
  /** Pixel size, or a Quiet Console token (xs–3xl). Default 14. */
  size?: number | IconSizeToken;
  /** Defaults to 1.8 to match existing chrome. */
  strokeWidth?: number | string;
};

export function iconSize(size: number | IconSizeToken = "xl"): number {
  return typeof size === "number" ? size : ICON_SIZE[size];
}

/**
 * Thin lucide wrapper — monochrome via currentColor, no decorative fill.
 */
export function Icon({
  icon: Lucide,
  size = "xl",
  strokeWidth = 1.8,
  absoluteStrokeWidth = false,
  "aria-hidden": ariaHidden = true,
  ...props
}: IconProps) {
  return (
    <Lucide
      size={iconSize(size)}
      strokeWidth={strokeWidth}
      absoluteStrokeWidth={absoluteStrokeWidth}
      aria-hidden={ariaHidden}
      {...props}
    />
  );
}
