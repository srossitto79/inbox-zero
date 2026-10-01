import type { calendar_v3 } from "@googleapis/calendar";
import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import { withCalendarSyncBudget } from "@/utils/calendar/calendar-sync-budget";
import { getCalendarClientWithRefresh } from "@/utils/calendar/client";
import { getCalendarConnectionState } from "@/utils/calendar/connection-scopes";
import {
  ALL_DAY_PADDING_MS,
  expandStoredEvents,
} from "@/utils/calendar/expand-events";
import type { BusyInterval } from "@/utils/calendar/find-a-time/find-free-slots";

// Google accepts at most 50 calendars per free/busy query.
const MAX_FREE_BUSY_ITEMS = 50;

export type GuestAvailability =
  | { status: "known"; busy: BusyInterval[] }
  | { status: "unknown" };

/**
 * Busy time on the user's enabled calendars, read from the local copy. Events
 * marked free, cancelled, or declined by the user do not block.
 */
export async function loadOwnBusy({
  emailAccountId,
  from,
  to,
  timeZone,
}: {
  emailAccountId: string;
  from: Date;
  to: Date;
  timeZone: string;
}): Promise<BusyInterval[]> {
  const calendars = await prisma.calendar.findMany({
    where: {
      isEnabled: true,
      connection: { emailAccountId, isConnected: true },
    },
    select: { id: true, name: true, color: true },
  });
  if (calendars.length === 0) return [];

  const paddedFrom = new Date(from.getTime() - ALL_DAY_PADDING_MS);
  const paddedTo = new Date(to.getTime() + ALL_DAY_PADDING_MS);
  const storedEvents = await prisma.calendarEvent.findMany({
    where: {
      calendarId: { in: calendars.map((calendar) => calendar.id) },
      OR: [
        { recurrence: { isEmpty: false } },
        { startTime: { lt: paddedTo }, endTime: { gt: paddedFrom } },
        {
          originalStartTime: { gte: paddedFrom, lt: paddedTo },
          recurringEventId: { not: null },
        },
      ],
    },
    select: {
      id: true,
      calendarId: true,
      providerEventId: true,
      title: true,
      description: true,
      location: true,
      startTime: true,
      endTime: true,
      isAllDay: true,
      timezone: true,
      status: true,
      isBusy: true,
      organizerEmail: true,
      organizerName: true,
      isOrganizer: true,
      selfResponseStatus: true,
      attendees: true,
      recurringEventId: true,
      recurrence: true,
      originalStartTime: true,
      videoLink: true,
      htmlLink: true,
    },
  });

  return expandStoredEvents({
    events: storedEvents,
    calendars: new Map(calendars.map((calendar) => [calendar.id, calendar])),
    range: { from, to },
    viewerTimeZone: timeZone,
  })
    .filter((event) => event.isBusy && event.selfResponseStatus !== "declined")
    .map(
      (event): BusyInterval =>
        event.isAllDay
          ? { allDay: true, startDate: event.start, endDate: event.end }
          : { start: new Date(event.start), end: new Date(event.end) },
    );
}

/**
 * Free/busy of other people through the user's Google connection. A guest the
 * provider cannot answer for is reported as unknown, never as free; so is
 * everybody when no usable connection exists or the provider call fails.
 */
export async function loadGuestAvailability({
  emailAccountId,
  emails,
  from,
  to,
  logger,
}: {
  emailAccountId: string;
  emails: string[];
  from: Date;
  to: Date;
  logger: Logger;
}): Promise<Record<string, GuestAvailability>> {
  const result: Record<string, GuestAvailability> = Object.fromEntries(
    emails.map((email) => [email, { status: "unknown" } as const]),
  );
  if (emails.length === 0) return result;

  const connections = await prisma.calendarConnection.findMany({
    where: { emailAccountId, provider: "google", isConnected: true },
    select: {
      id: true,
      provider: true,
      isConnected: true,
      scope: true,
      accessToken: true,
      refreshToken: true,
      expiresAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const connection = connections.find(
    (candidate) => getCalendarConnectionState(candidate) === "connected",
  );
  if (!connection) return result;

  try {
    for (let index = 0; index < emails.length; index += MAX_FREE_BUSY_ITEMS) {
      const batch = emails.slice(index, index + MAX_FREE_BUSY_ITEMS);
      const calendars = await withCalendarSyncBudget(
        { emailAccountId, provider: "google" },
        async () => {
          const client = await getCalendarClientWithRefresh({
            accessToken: connection.accessToken,
            refreshToken: connection.refreshToken,
            expiresAt: connection.expiresAt?.getTime() ?? null,
            emailAccountId,
            connectionId: connection.id,
            logger,
          });
          const response = await client.freebusy.query({
            requestBody: {
              timeMin: from.toISOString(),
              timeMax: to.toISOString(),
              items: batch.map((id) => ({ id })),
            },
          });
          return response.data.calendars ?? {};
        },
      );
      Object.assign(result, parseFreeBusy(batch, calendars));
    }
  } catch (error) {
    logger.warn("Guest free/busy lookup failed", { error });
    // Anything not answered before the failure stays unknown.
  }
  return result;
}

function parseFreeBusy(
  emails: string[],
  calendars: Record<string, calendar_v3.Schema$FreeBusyCalendar>,
) {
  const lookup = new Map(
    Object.entries(calendars).map(([id, value]) => [id.toLowerCase(), value]),
  );
  const parsed: Record<string, GuestAvailability> = {};
  for (const email of emails) {
    const entry = lookup.get(email.toLowerCase());
    if (!entry || entry.errors?.length) {
      parsed[email] = { status: "unknown" };
      continue;
    }
    parsed[email] = {
      status: "known",
      busy: (entry.busy ?? []).flatMap((period) =>
        period.start && period.end
          ? [{ start: new Date(period.start), end: new Date(period.end) }]
          : [],
      ),
    };
  }
  return parsed;
}
