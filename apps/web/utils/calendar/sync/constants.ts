const DAY_MS = 24 * 60 * 60 * 1000;

/** Events inside this window are synced; Google series keep their full rule. */
export const CALENDAR_SYNC_WINDOW = {
  pastDays: 90,
  futureDays: 365,
} as const;

/**
 * An incremental cursor is tied to the window it was issued for, so the window
 * cannot slide. When less than this much future is left the calendar does a
 * full sync with a fresh window.
 */
export const WINDOW_REFRESH_MARGIN_MS = 60 * DAY_MS;

/** Shortest gap between two automatic syncs of one calendar. */
export const CALENDAR_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** How long before the provider's calendar list (names, colors) is re-read. */
export const CALENDAR_LIST_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** A SYNCING claim older than this belongs to a crashed run. */
export const SYNC_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

export const SYNC_ERROR_RETRY_MS = 15 * 60 * 1000;

/** Upper bound on pages fetched per calendar per run; progress is saved. */
export const MAX_PAGES_PER_RUN = 40;

export function getSyncWindow(now: Date) {
  return {
    from: new Date(now.getTime() - CALENDAR_SYNC_WINDOW.pastDays * DAY_MS),
    to: new Date(now.getTime() + CALENDAR_SYNC_WINDOW.futureDays * DAY_MS),
  };
}
