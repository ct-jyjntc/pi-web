/**
 * Shared dismiss rules for floating menus (session row, file tree, composer).
 * Single owner: scroll/pointer filters used by menu components.
 */

/**
 * Whether a capture-phase scroll should close a fixed-position menu.
 * Chat transcript auto-scroll (stick-to-bottom while streaming) must NOT dismiss.
 */
export function shouldDismissMenuOnScroll(
  event: Event,
  menuEl: HTMLElement | null | undefined,
): boolean {
  const target = event.target;
  // Duck-type contains/closest so unit tests need no DOM globals.
  if (
    menuEl
    && target
    && typeof menuEl.contains === "function"
    && menuEl.contains(target as Node)
  ) {
    return false;
  }
  const el = target && typeof (target as { closest?: unknown }).closest === "function"
    ? (target as Element)
    : null;
  // Live chat scroller + nested overflow under the transcript column.
  if (el?.closest(".chat-scroll-area, .chat-scroll-clip, .chat-content, [data-chat-scroll]")) {
    return false;
  }
  return true;
}
