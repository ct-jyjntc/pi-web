/**
 * Clamp / parse helpers for persisted drag-resizable panel widths.
 */

export function panelWidthCap(hardMax: number, viewportWidth: number, viewportFraction: number): number {
  return Math.min(hardMax, Math.floor(viewportWidth * viewportFraction));
}

export function clampPanelWidth(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function parseStoredPanelWidth(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
