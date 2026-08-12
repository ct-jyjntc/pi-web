export const VISIBLE_PAGE_SIZE = 50;

export function getVisibleRenderWindow(totalCount: number, visibleCount: number): {
  startIndex: number;
  hasMore: boolean;
} {
  const clampedVisibleCount = Math.min(Math.max(visibleCount, 0), Math.max(totalCount, 0));
  const startIndex = Math.max(0, totalCount - clampedVisibleCount);
  return { startIndex, hasMore: startIndex > 0 };
}

export function getNextVisibleCount(currentVisibleCount: number, pageSize = VISIBLE_PAGE_SIZE): number {
  return currentVisibleCount + pageSize;
}

export function captureScrollDistance(scrollHeight: number, scrollTop: number): number {
  return scrollHeight - scrollTop;
}

export function restoreScrollTop(scrollHeight: number, savedDistance: number): number {
  return Math.max(0, scrollHeight - savedDistance);
}

/** Pixels from the top that count as "scrolled to earlier history". */
export const PAGE_EARLIER_TOP_PX = 8;

/**
 * Whether the transcript viewport should page in older render items.
 * IntersectionObserver on a custom overflow root misses this when the
 * sentinel is already on screen (no further scroll) or the list does not
 * overflow — both common when only a few items are hidden.
 */
export function shouldPageEarlierMessages(
  box: { scrollTop: number; scrollHeight: number; clientHeight: number },
  topPx = PAGE_EARLIER_TOP_PX,
): boolean {
  if (box.clientHeight <= 0) return false;
  if (box.scrollHeight <= box.clientHeight + 1) return true;
  return box.scrollTop <= topPx;
}
