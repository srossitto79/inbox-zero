import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import {
  CalendarSyncPausedError,
  withCalendarSyncBudget,
} from "@/utils/calendar/calendar-sync-budget";
import { classifyCalendarSyncError } from "@/utils/calendar/sync/classify-sync-error";
import {
  CALENDAR_SYNC_INTERVAL_MS,
  getSyncWindow,
  MAX_PAGES_PER_RUN,
  SYNC_CLAIM_TIMEOUT_MS,
  SYNC_ERROR_RETRY_MS,
  WINDOW_REFRESH_MARGIN_MS,
} from "@/utils/calendar/sync/constants";
import {
  planEventChanges,
  type EventChangePlan,
} from "@/utils/calendar/sync/plan-event-changes";
import {
  type EventSyncSource,
  SyncCursorExpiredError,
} from "@/utils/calendar/sync/types";

export type CalendarSyncOutcome =
  | "synced"
  | "skipped"
  | "paused"
  | "needs_reconnect"
  | "error";

export type SyncableCalendar = {
  id: string;
  calendarId: string;
  timezone: string | null;
  syncStatus: "IDLE" | "SYNCING" | "PAUSED" | "ERROR" | "NEEDS_RECONNECT";
  syncCursor: string | null;
  syncPageToken: string | null;
  fullSyncStartedAt: Date | null;
  syncStartedAt: Date | null;
  lastSyncedAt: Date | null;
  syncWindowStart: Date | null;
  syncWindowEnd: Date | null;
  syncRetryAt: Date | null;
};

type SyncState = {
  cursor: string | null;
  pageToken: string | null;
  fullSyncStartedAt: Date | null;
  window: { from: Date; to: Date } | null;
};

/**
 * Brings one calendar's stored events up to date. A calendar is either in a
 * full sync (no cursor: reads the window page by page, then drops what the
 * provider no longer returns) or incremental (a cursor: reads only changes).
 * Progress is saved after every page, so a pause or crash resumes instead of
 * starting over, and the cursor is only replaced once the last page is applied.
 */
export async function syncCalendar({
  calendar,
  source,
  emailAccountId,
  provider,
  logger,
  force = false,
  now = new Date(),
}: {
  calendar: SyncableCalendar;
  source: EventSyncSource;
  emailAccountId: string;
  provider: "google" | "microsoft";
  logger: Logger;
  force?: boolean;
  now?: Date;
}): Promise<CalendarSyncOutcome> {
  if (!isCalendarDue(calendar, now, force)) return "skipped";

  const claim = await prisma.calendar.updateMany({
    where: {
      id: calendar.id,
      OR: [
        { syncStatus: { not: "SYNCING" } },
        {
          syncStartedAt: {
            lt: new Date(now.getTime() - SYNC_CLAIM_TIMEOUT_MS),
          },
        },
      ],
    },
    data: { syncStatus: "SYNCING", syncStartedAt: now },
  });
  if (claim.count === 0) return "skipped";

  const calendarLogger = logger.with({ calendarId: calendar.id });
  try {
    return await runSync({
      calendar,
      source,
      emailAccountId,
      provider,
      now,
    });
  } catch (error) {
    return await recordFailure({
      calendar,
      error,
      now,
      logger: calendarLogger,
    });
  }
}

export function isCalendarDue(
  calendar: Pick<
    SyncableCalendar,
    "syncStatus" | "syncRetryAt" | "lastSyncedAt" | "syncStartedAt"
  >,
  now: Date,
  force: boolean,
) {
  const retryPending =
    calendar.syncRetryAt !== null && calendar.syncRetryAt > now;
  // A rate-limit pause is never overridden, not even by "Sync now".
  if (calendar.syncStatus === "PAUSED" && retryPending) return false;
  if (force) return true;
  // The user has to reconnect first; a successful reconnect resets the status.
  if (calendar.syncStatus === "NEEDS_RECONNECT") return false;
  if (retryPending) return false;
  if (!calendar.lastSyncedAt) return true;
  return (
    now.getTime() - calendar.lastSyncedAt.getTime() >= CALENDAR_SYNC_INTERVAL_MS
  );
}

async function runSync({
  calendar,
  source,
  emailAccountId,
  provider,
  now,
}: {
  calendar: SyncableCalendar;
  source: EventSyncSource;
  emailAccountId: string;
  provider: "google" | "microsoft";
  now: Date;
}): Promise<CalendarSyncOutcome> {
  let state: SyncState = {
    cursor: calendar.syncCursor,
    pageToken: calendar.syncPageToken,
    fullSyncStartedAt: calendar.fullSyncStartedAt,
    window:
      calendar.syncWindowStart && calendar.syncWindowEnd
        ? { from: calendar.syncWindowStart, to: calendar.syncWindowEnd }
        : null,
  };

  const needsNewWindow =
    state.cursor !== null &&
    (!state.window ||
      state.window.to.getTime() - now.getTime() < WINDOW_REFRESH_MARGIN_MS);
  const needsFullSync =
    state.cursor === null && (!state.fullSyncStartedAt || !state.window);
  if (needsNewWindow || needsFullSync) {
    state = await beginFullSync(calendar.id, now);
  }

  let restarted = false;
  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    const window = state.window as { from: Date; to: Date };
    let result: Awaited<ReturnType<EventSyncSource["fetchPage"]>>;
    try {
      result = await withCalendarSyncBudget({ emailAccountId, provider }, () =>
        source.fetchPage({
          calendarId: calendar.calendarId,
          cursor: state.cursor,
          pageToken: state.pageToken,
          window,
          calendarTimeZone: calendar.timezone,
        }),
      );
    } catch (error) {
      // An unknown cursor or page token cannot be repaired by retrying; the
      // only way forward is a full sync, once per run.
      if (error instanceof SyncCursorExpiredError && !restarted) {
        restarted = true;
        state = await beginFullSync(calendar.id, now);
        continue;
      }
      throw error;
    }

    await applyEventChanges(calendar.id, planEventChanges(result.items));

    if (result.nextPageToken) {
      state = { ...state, pageToken: result.nextPageToken };
      await prisma.calendar.update({
        where: { id: calendar.id },
        data: {
          syncPageToken: result.nextPageToken,
          syncStartedAt: new Date(),
        },
      });
      continue;
    }

    if (!result.nextCursor) {
      throw new Error("Provider did not return a sync cursor");
    }
    if (state.fullSyncStartedAt) {
      // Everything the provider still has was rewritten after the start of
      // this full sync; whatever was not is gone upstream.
      await prisma.calendarEvent.deleteMany({
        where: {
          calendarId: calendar.id,
          updatedAt: { lt: state.fullSyncStartedAt },
        },
      });
    }

    await prisma.calendar.update({
      where: { id: calendar.id },
      data: {
        syncStatus: "IDLE",
        syncCursor: result.nextCursor,
        syncPageToken: null,
        fullSyncStartedAt: null,
        lastSyncedAt: now,
        syncError: null,
        syncRetryAt: null,
      },
    });
    return "synced";
  }

  // Large calendar: keep what was read and continue on the next run.
  await prisma.calendar.update({
    where: { id: calendar.id },
    data: {
      syncStatus: "PAUSED",
      syncRetryAt: new Date(now.getTime() + 60_000),
    },
  });
  return "paused";
}

async function beginFullSync(
  calendarId: string,
  now: Date,
): Promise<SyncState> {
  const window = getSyncWindow(now);
  await prisma.calendar.update({
    where: { id: calendarId },
    data: {
      syncCursor: null,
      syncPageToken: null,
      fullSyncStartedAt: now,
      syncWindowStart: window.from,
      syncWindowEnd: window.to,
    },
  });
  return { cursor: null, pageToken: null, fullSyncStartedAt: now, window };
}

// Array-form transaction: the replacement of a page is all or nothing, so the
// views never see an event deleted without its new version.
async function applyEventChanges(calendarId: string, plan: EventChangePlan) {
  const operations = [];

  const removals = [
    ...(plan.removedIds.length > 0
      ? [{ providerEventId: { in: plan.removedIds } }]
      : []),
    ...(plan.removedSeriesIds.length > 0
      ? [{ recurringEventId: { in: plan.removedSeriesIds } }]
      : []),
  ];
  if (removals.length > 0) {
    operations.push(
      prisma.calendarEvent.deleteMany({
        where: { calendarId, OR: removals },
      }),
    );
  }

  if (plan.upserts.length > 0) {
    operations.push(
      prisma.calendarEvent.deleteMany({
        where: {
          calendarId,
          providerEventId: {
            in: plan.upserts.map((row) => row.providerEventId),
          },
        },
      }),
      prisma.calendarEvent.createMany({
        data: plan.upserts.map((row) => ({ ...row, calendarId })),
      }),
    );
  }

  if (operations.length > 0) await prisma.$transaction(operations);
}

async function recordFailure({
  calendar,
  error,
  now,
  logger,
}: {
  calendar: SyncableCalendar;
  error: unknown;
  now: Date;
  logger: Logger;
}): Promise<CalendarSyncOutcome> {
  if (error instanceof CalendarSyncPausedError) {
    logger.warn("Calendar sync paused", { retryAfterMs: error.retryAfterMs });
    await prisma.calendar.update({
      where: { id: calendar.id },
      data: {
        syncStatus: "PAUSED",
        syncRetryAt: new Date(now.getTime() + error.retryAfterMs),
      },
    });
    return "paused";
  }

  const failure = classifyCalendarSyncError(error);
  if (failure === "needs_reconnect") {
    logger.warn("Calendar sync needs a reconnect", { error });
    await prisma.calendar.update({
      where: { id: calendar.id },
      data: { syncStatus: "NEEDS_RECONNECT", syncError: "Reconnect required" },
    });
    return "needs_reconnect";
  }

  logger.error("Calendar sync failed", { error });
  await prisma.calendar.update({
    where: { id: calendar.id },
    data: {
      syncStatus: "ERROR",
      syncError: failure === "not_found" ? "Calendar not found" : "Sync failed",
      syncRetryAt: new Date(now.getTime() + SYNC_ERROR_RETRY_MS),
    },
  });
  return "error";
}
