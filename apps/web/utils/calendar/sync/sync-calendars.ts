import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import {
  CalendarSyncPausedError,
  withCalendarSyncBudget,
} from "@/utils/calendar/calendar-sync-budget";
import { getCalendarClientWithRefresh as getGoogleCalendarClient } from "@/utils/calendar/client";
import {
  CALENDAR_LIST_REFRESH_INTERVAL_MS,
  CALENDAR_SYNC_INTERVAL_MS,
} from "@/utils/calendar/sync/constants";
import { classifyCalendarSyncError } from "@/utils/calendar/sync/classify-sync-error";
import { createGoogleEventSource } from "@/utils/calendar/sync/google-event-source";
import { createMicrosoftEventSource } from "@/utils/calendar/sync/microsoft-event-source";
import {
  mapGoogleCalendar,
  mapMicrosoftCalendar,
  saveProviderCalendars,
} from "@/utils/calendar/sync/refresh-calendar-list";
import {
  type CalendarSyncOutcome,
  syncCalendar,
} from "@/utils/calendar/sync/sync-calendar";
import type { EventSyncSource } from "@/utils/calendar/sync/types";
import { getCalendarClientWithRefresh as getMicrosoftCalendarClient } from "@/utils/outlook/calendar-client";
import {
  isGoogleProvider,
  isMicrosoftProvider,
} from "@/utils/email/provider-types";

type MicrosoftCalendar = Parameters<typeof mapMicrosoftCalendar>[0];

export type CalendarSyncSummary = Record<CalendarSyncOutcome, number>;

const DUE_CALENDAR_BATCH = 200;

/** One account's enabled calendars. `force` ignores the minimum sync interval. */
export async function syncEmailAccountCalendars({
  emailAccountId,
  force = false,
  logger,
  deadline = Number.POSITIVE_INFINITY,
}: {
  emailAccountId: string;
  force?: boolean;
  logger: Logger;
  /** Epoch milliseconds after which no new calendar is started. */
  deadline?: number;
}): Promise<CalendarSyncSummary> {
  const summary = emptySummary();
  const connections = await prisma.calendarConnection.findMany({
    where: { emailAccountId, isConnected: true, refreshToken: { not: null } },
    select: {
      id: true,
      provider: true,
      accessToken: true,
      refreshToken: true,
      expiresAt: true,
      calendarListSyncedAt: true,
    },
  });

  for (const connection of connections) {
    if (Date.now() > deadline) break;
    const outcomes = await syncConnection({
      connection,
      emailAccountId,
      force,
      logger: logger.with({ connectionId: connection.id }),
      deadline,
    });
    for (const outcome of outcomes) summary[outcome] += 1;
  }

  return summary;
}

/** Cron entry point: the calendars that are due, least recently synced first. */
export async function syncDueCalendars({
  logger,
  deadline,
}: {
  logger: Logger;
  deadline: number;
}) {
  const now = new Date();
  const due = await prisma.calendar.findMany({
    where: {
      isEnabled: true,
      syncStatus: { not: "NEEDS_RECONNECT" },
      connection: { isConnected: true, refreshToken: { not: null } },
      AND: [
        {
          OR: [
            { lastSyncedAt: null },
            {
              lastSyncedAt: {
                lt: new Date(now.getTime() - CALENDAR_SYNC_INTERVAL_MS),
              },
            },
          ],
        },
        { OR: [{ syncRetryAt: null }, { syncRetryAt: { lte: now } }] },
      ],
    },
    orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
    take: DUE_CALENDAR_BATCH,
    select: { connection: { select: { emailAccountId: true } } },
  });
  const emailAccountIds = [
    ...new Set(due.map((calendar) => calendar.connection.emailAccountId)),
  ];

  const total = emptySummary();
  let accounts = 0;
  for (const emailAccountId of emailAccountIds) {
    if (Date.now() > deadline) break;
    accounts += 1;
    try {
      const summary = await syncEmailAccountCalendars({
        emailAccountId,
        logger: logger.with({ emailAccountId }),
        deadline,
      });
      for (const outcome of Object.keys(summary) as CalendarSyncOutcome[]) {
        total[outcome] += summary[outcome];
      }
    } catch (error) {
      total.error += 1;
      logger.error("Failed to sync calendar account", {
        emailAccountId,
        error,
      });
    }
  }

  return { accounts, ...total };
}

async function syncConnection({
  connection,
  emailAccountId,
  force,
  logger,
  deadline,
}: {
  connection: {
    id: string;
    provider: string;
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: Date | null;
    calendarListSyncedAt: Date | null;
  };
  emailAccountId: string;
  force: boolean;
  logger: Logger;
  deadline: number;
}): Promise<CalendarSyncOutcome[]> {
  const provider = getProvider(connection.provider);
  if (!provider) return [];

  let handle: ConnectionHandle;
  try {
    handle = await createConnectionHandle({
      provider,
      connection,
      emailAccountId,
      logger,
    });
  } catch (error) {
    return [await recordConnectionFailure(connection.id, error, logger)];
  }

  const listIsStale =
    !connection.calendarListSyncedAt ||
    Date.now() - connection.calendarListSyncedAt.getTime() >=
      CALENDAR_LIST_REFRESH_INTERVAL_MS;
  if (force || listIsStale) {
    try {
      await withCalendarSyncBudget({ emailAccountId, provider }, () =>
        handle.refreshCalendarList(connection.id),
      );
    } catch (error) {
      if (error instanceof CalendarSyncPausedError) return ["paused"];
      // Colors and new calendars can wait; stored events are still valid.
      logger.warn("Failed to refresh calendar list", { error });
    }
  }

  const calendars = await prisma.calendar.findMany({
    where: { connectionId: connection.id, isEnabled: true },
    select: {
      id: true,
      calendarId: true,
      timezone: true,
      syncStatus: true,
      syncCursor: true,
      syncPageToken: true,
      fullSyncStartedAt: true,
      syncStartedAt: true,
      lastSyncedAt: true,
      syncWindowStart: true,
      syncWindowEnd: true,
      syncRetryAt: true,
    },
    orderBy: [{ primary: "desc" }, { name: "asc" }],
  });

  const outcomes: CalendarSyncOutcome[] = [];
  for (const calendar of calendars) {
    if (Date.now() > deadline) break;
    const outcome = await syncCalendar({
      calendar,
      source: handle.source,
      emailAccountId,
      provider,
      logger,
      force,
    });
    outcomes.push(outcome);
    // A pause is account-wide: the remaining calendars would hit it too.
    if (outcome === "paused" || outcome === "needs_reconnect") break;
  }
  return outcomes;
}

type ConnectionHandle = {
  source: EventSyncSource;
  refreshCalendarList: (connectionId: string) => Promise<void>;
};

async function createConnectionHandle({
  provider,
  connection,
  emailAccountId,
  logger,
}: {
  provider: "google" | "microsoft";
  connection: {
    id: string;
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: Date | null;
  };
  emailAccountId: string;
  logger: Logger;
}): Promise<ConnectionHandle> {
  const tokens = {
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    expiresAt: connection.expiresAt?.getTime() ?? null,
    emailAccountId,
    connectionId: connection.id,
    logger,
  };

  if (provider === "google") {
    const client = await getGoogleCalendarClient({
      ...tokens,
      connectionId: connection.id,
    });
    return {
      source: createGoogleEventSource(client),
      // Called directly rather than through fetchGoogleCalendars, which turns
      // every failure into a SafeError and hides rate limits from the budget.
      refreshCalendarList: async (connectionId) => {
        const { data } = await client.calendarList.list({ maxResults: 250 });
        await saveProviderCalendars({
          connectionId,
          calendars: (data.items ?? []).flatMap((calendar) => {
            const mapped = mapGoogleCalendar(calendar);
            return mapped ? [mapped] : [];
          }),
        });
      },
    };
  }

  const client = await getMicrosoftCalendarClient(tokens);
  return {
    source: createMicrosoftEventSource(client),
    refreshCalendarList: async (connectionId) => {
      const response = await client
        .api("/me/calendars")
        .select("id,name,hexColor,isDefaultCalendar,canEdit")
        .get();
      await saveProviderCalendars({
        connectionId,
        calendars: (response.value ?? []).flatMap(
          (calendar: MicrosoftCalendar) => {
            const mapped = mapMicrosoftCalendar(calendar);
            return mapped ? [mapped] : [];
          },
        ),
      });
    },
  };
}

// Failing to obtain a client is almost always a revoked or expired grant.
async function recordConnectionFailure(
  connectionId: string,
  error: unknown,
  logger: Logger,
): Promise<CalendarSyncOutcome> {
  if (classifyCalendarSyncError(error) === "needs_reconnect") {
    logger.warn("Calendar connection needs a reconnect", { error });
    await prisma.calendar.updateMany({
      where: { connectionId, isEnabled: true },
      data: { syncStatus: "NEEDS_RECONNECT", syncError: "Reconnect required" },
    });
    return "needs_reconnect";
  }

  logger.error("Failed to open calendar connection", { error });
  return "error";
}

function getProvider(provider: string) {
  if (isGoogleProvider(provider)) return "google" as const;
  if (isMicrosoftProvider(provider)) return "microsoft" as const;
  return null;
}

function emptySummary(): CalendarSyncSummary {
  return { synced: 0, skipped: 0, paused: 0, needs_reconnect: 0, error: 0 };
}
