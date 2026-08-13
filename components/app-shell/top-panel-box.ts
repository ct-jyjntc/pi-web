/**
 * Geometry for the top-bar branch/system overlay: the bar minus the
 * trailing rail (file-panel toggle), so the panel never covers that strip.
 */

export const TOPBAR_TRAILING_SELECTOR = ".app-topbar-trailing";

export function topPanelBoxFromRects(
  bar: { left: number; bottom: number; width: number },
  trailingLeft: number | null,
): { top: number; left: number; width: number } {
  const right = trailingLeft ?? bar.left + bar.width;
  return {
    top: bar.bottom,
    left: bar.left,
    width: Math.max(0, right - bar.left),
  };
}

export function measureTopPanelBox(topBar: HTMLElement): { top: number; left: number; width: number } {
  const rect = topBar.getBoundingClientRect();
  const trailing = topBar.querySelector(TOPBAR_TRAILING_SELECTOR);
  const trailingLeft = trailing instanceof HTMLElement
    ? trailing.getBoundingClientRect().left
    : null;
  return topPanelBoxFromRects(rect, trailingLeft);
}
