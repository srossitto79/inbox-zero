/** Minimum horizontal travel, and how much it must beat vertical, to count. */
const SWIPE_MIN_PX = 48;
const SWIPE_DOMINANCE = 1.5;

/**
 * A horizontal swipe on the reader, in the direction Gmail uses: dragging
 * right-to-left goes to the next conversation, left-to-right to the previous.
 * Returns null for a tap or a vertical scroll.
 */
export function getSwipeNavigation(input: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}): "next" | "previous" | null {
  const dx = input.endX - input.startX;
  const dy = input.endY - input.startY;
  if (Math.abs(dx) < SWIPE_MIN_PX) return null;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_DOMINANCE) return null;
  return dx < 0 ? "next" : "previous";
}
