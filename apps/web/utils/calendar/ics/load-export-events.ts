import prisma from "@/utils/prisma";
import { parseAttendees } from "@/utils/calendar/expand-events";
import type { IcsExportEvent } from "@/utils/calendar/ics/build-ics";

export const ICS_EXPORT_MAX_EVENTS = 5000;

export type IcsExportSelection =
  | { type: "event"; eventId: string }
  | { type: "calendar"; calendarId: string; from?: Date; to?: Date }
  | { type: "range"; from: Date; to: Date };

const eventSelect = {
  providerEventId: true,
  iCalUid: true,
  providerUpdatedAt: true,
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
  attendees: true,
  recurringEventId: true,
  recurrence: true,
  originalStartTime: true,
  htmlLink: true,
} as const;

/**
 * Events of the account for an export, or null when the selection names
 * nothing the account owns. A series master brings its exceptions along.
 */
export async function loadIcsExport({
  emailAccountId,
  selection,
}: {
  emailAccountId: string;
  selection: IcsExportSelection;
}): Promise<{
  name: string;
  events: IcsExportEvent[];
  truncated: boolean;
} | null> {
  const owned = { connection: { emailAccountId } };

  if (selection.type === "event") {
    const event = await prisma.calendarEvent.findFirst({
      where: { id: selection.eventId, calendar: owned },
      select: { ...eventSelect, calendarId: true },
    });
    if (!event) return null;

    const exceptions = event.recurrence.length
      ? await prisma.calendarEvent.findMany({
          where: {
            calendarId: event.calendarId,
            recurringEventId: event.providerEventId,
          },
          select: eventSelect,
          take: ICS_EXPORT_MAX_EVENTS,
        })
      : [];
    return {
      name: event.title || "event",
      events: [event, ...exceptions].map(toExportEvent),
      truncated: false,
    };
  }

  const calendars =
    selection.type === "calendar"
      ? await prisma.calendar.findMany({
          where: { id: selection.calendarId, ...owned },
          select: { id: true, name: true },
        })
      : await prisma.calendar.findMany({
          where: { isEnabled: true, ...owned },
          select: { id: true, name: true },
        });
  if (calendars.length === 0) return null;

  const range = getRange(selection);
  const rows = await prisma.calendarEvent.findMany({
    where: {
      calendarId: { in: calendars.map((calendar) => calendar.id) },
      // A cancelled exception still tells readers to skip its slot.
      OR: [
        { status: { not: "CANCELLED" }, recurringEventId: null },
        { recurringEventId: { not: null } },
      ],
      AND: range
        ? [
            {
              OR: [
                // Series are exported whole; their rules decide what falls in range.
                { recurrence: { isEmpty: false } },
                { startTime: { lt: range.to }, endTime: { gt: range.from } },
                {
                  recurringEventId: { not: null },
                  originalStartTime: { gte: range.from, lt: range.to },
                },
              ],
            },
          ]
        : [],
    },
    select: eventSelect,
    orderBy: { startTime: "asc" },
    take: ICS_EXPORT_MAX_EVENTS + 1,
  });

  return {
    name:
      calendars.length === 1 && selection.type === "calendar"
        ? calendars[0].name
        : "calendar",
    events: rows.slice(0, ICS_EXPORT_MAX_EVENTS).map(toExportEvent),
    truncated: rows.length > ICS_EXPORT_MAX_EVENTS,
  };
}

function getRange(selection: IcsExportSelection) {
  if (selection.type === "event") return null;
  return selection.from && selection.to
    ? { from: selection.from, to: selection.to }
    : null;
}

function toExportEvent(row: {
  providerEventId: string;
  iCalUid: string | null;
  providerUpdatedAt: Date | null;
  title: string;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  timezone: string | null;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  isBusy: boolean;
  organizerEmail: string | null;
  organizerName: string | null;
  attendees: unknown;
  recurringEventId: string | null;
  recurrence: string[];
  originalStartTime: Date | null;
  htmlLink: string | null;
}): IcsExportEvent {
  return {
    uid: row.iCalUid ?? `${row.providerEventId}@inbox-zero`,
    title: row.title,
    description: row.description,
    location: row.location,
    start: row.startTime,
    end: row.endTime,
    isAllDay: row.isAllDay,
    timezone: row.timezone,
    status: row.status,
    isBusy: row.isBusy,
    recurrence: row.recurringEventId ? [] : row.recurrence,
    originalStartTime: row.recurringEventId ? row.originalStartTime : null,
    organizer: row.organizerEmail
      ? { email: row.organizerEmail, name: row.organizerName }
      : null,
    attendees: parseAttendees(row.attendees),
    url: row.htmlLink,
    updatedAt: row.providerUpdatedAt,
  };
}
