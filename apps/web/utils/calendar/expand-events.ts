import type { CalendarEventStatus } from "@/generated/prisma/enums";
import { expandRecurringEvent, getSlotKey } from "@/utils/calendar/recurrence";
import { formatDateKey, startOfLocalDay } from "@/utils/calendar/zoned-time";

export type EventAttendee = {
  email: string;
  name?: string;
  responseStatus?: string;
  isSelf?: boolean;
  isOrganizer?: boolean;
};

export type StoredCalendarEvent = {
  id: string;
  calendarId: string;
  providerEventId: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  timezone: string | null;
  status: CalendarEventStatus;
  isBusy: boolean;
  organizerEmail: string | null;
  organizerName: string | null;
  isOrganizer: boolean;
  selfResponseStatus: string | null;
  attendees: unknown;
  recurringEventId: string | null;
  recurrence: string[];
  originalStartTime: Date | null;
  videoLink: string | null;
  htmlLink: string | null;
};

export type CalendarSummary = {
  id: string;
  name: string;
  color: string | null;
};

export type CalendarViewEvent = {
  /** Unique per occurrence; a series master repeats its row id per slot. */
  id: string;
  calendarId: string;
  calendarName: string;
  calendarColor: string | null;
  providerEventId: string;
  recurringEventId: string | null;
  isRecurring: boolean;
  title: string;
  description: string | null;
  location: string | null;
  isAllDay: boolean;
  /** ISO instant, or `YYYY-MM-DD` for all-day events. */
  start: string;
  /** ISO instant, or exclusive `YYYY-MM-DD` for all-day events. */
  end: string;
  timezone: string | null;
  status: "CONFIRMED" | "TENTATIVE";
  isBusy: boolean;
  organizer: { email: string | null; name: string | null; isSelf: boolean };
  attendees: EventAttendee[];
  selfResponseStatus: string | null;
  videoLink: string | null;
  htmlLink: string | null;
};

/**
 * Turns stored rows into the events visible in `range`: series masters are
 * expanded, instances replaced or cancelled by an exception are dropped, and
 * cancelled events are hidden. All-day events overlap the range by the local
 * days of `viewerTimeZone`.
 */
export function expandStoredEvents({
  events,
  calendars,
  range,
  viewerTimeZone,
}: {
  events: StoredCalendarEvent[];
  calendars: Map<string, CalendarSummary>;
  range: { from: Date; to: Date };
  viewerTimeZone: string;
}): CalendarViewEvent[] {
  const masters = new Map(
    events.filter(isSeriesMaster).map((master) => [seriesKey(master), master]),
  );
  const exceptionSlots = new Map<string, Set<string>>();
  for (const event of events) {
    if (!event.recurringEventId || !event.originalStartTime) continue;
    const key = `${event.calendarId}:${event.recurringEventId}`;
    const master = masters.get(key);
    if (!master) continue;
    const slots = exceptionSlots.get(key) ?? new Set<string>();
    slots.add(
      getSlotKey({
        instant: event.originalStartTime,
        timeZone: master.timezone,
        isAllDay: master.isAllDay,
      }),
    );
    exceptionSlots.set(key, slots);
  }

  const result: CalendarViewEvent[] = [];
  const push = (view: CalendarViewEvent) => {
    if (overlapsRange(view, range, viewerTimeZone)) result.push(view);
  };

  for (const event of events) {
    const calendar = calendars.get(event.calendarId);
    if (!calendar || event.status === "CANCELLED") continue;

    if (!isSeriesMaster(event)) {
      push(toViewEvent({ event, calendar, id: event.id }));
      continue;
    }

    const skipped = exceptionSlots.get(seriesKey(event));
    const occurrences = expandRecurringEvent(event, {
      from: new Date(range.from.getTime() - ALL_DAY_PADDING_MS),
      to: new Date(range.to.getTime() + ALL_DAY_PADDING_MS),
    });
    for (const occurrence of occurrences) {
      if (skipped?.has(occurrence.slotKey)) continue;
      push(
        toViewEvent({
          event,
          calendar,
          id: `${event.id}:${occurrence.slotKey}`,
          startTime: occurrence.startTime,
          endTime: occurrence.endTime,
        }),
      );
    }
  }

  return result.sort(
    (a, b) =>
      Number(b.isAllDay) - Number(a.isAllDay) ||
      a.start.localeCompare(b.start) ||
      a.id.localeCompare(b.id),
  );
}

/** Wider than any UTC offset, so all-day rows are never missed by the query. */
export const ALL_DAY_PADDING_MS = 14 * 60 * 60 * 1000;

export function parseAttendees(value: unknown): EventAttendee[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.email !== "string" || !record.email) return [];
    return [
      {
        email: record.email,
        name: typeof record.name === "string" ? record.name : undefined,
        responseStatus:
          typeof record.responseStatus === "string"
            ? record.responseStatus
            : undefined,
        isSelf: record.isSelf === true ? true : undefined,
        isOrganizer: record.isOrganizer === true ? true : undefined,
      },
    ];
  });
}

function isSeriesMaster(event: StoredCalendarEvent) {
  return event.recurrence.length > 0 && !event.recurringEventId;
}

function seriesKey(master: StoredCalendarEvent) {
  return `${master.calendarId}:${master.providerEventId}`;
}

function toViewEvent({
  event,
  calendar,
  id,
  startTime = event.startTime,
  endTime = event.endTime,
}: {
  event: StoredCalendarEvent;
  calendar: CalendarSummary;
  id: string;
  startTime?: Date;
  endTime?: Date;
}): CalendarViewEvent {
  return {
    id,
    calendarId: calendar.id,
    calendarName: calendar.name,
    calendarColor: calendar.color,
    providerEventId: event.providerEventId,
    recurringEventId: isSeriesMaster(event)
      ? event.providerEventId
      : event.recurringEventId,
    isRecurring: isSeriesMaster(event) || event.recurringEventId !== null,
    title: event.title,
    description: event.description,
    location: event.location,
    isAllDay: event.isAllDay,
    start: event.isAllDay ? toUtcDateKey(startTime) : startTime.toISOString(),
    end: event.isAllDay ? toUtcDateKey(endTime) : endTime.toISOString(),
    timezone: event.timezone,
    status: event.status === "TENTATIVE" ? "TENTATIVE" : "CONFIRMED",
    isBusy: event.isBusy,
    organizer: {
      email: event.organizerEmail,
      name: event.organizerName,
      isSelf: event.isOrganizer,
    },
    attendees: parseAttendees(event.attendees),
    selfResponseStatus: event.selfResponseStatus,
    videoLink: event.videoLink,
    htmlLink: event.htmlLink,
  };
}

function overlapsRange(
  event: CalendarViewEvent,
  range: { from: Date; to: Date },
  viewerTimeZone: string,
) {
  const start = event.isAllDay
    ? startOfLocalDay(event.start, viewerTimeZone)
    : new Date(event.start);
  const end = event.isAllDay
    ? startOfLocalDay(event.end, viewerTimeZone)
    : new Date(event.end);
  // A zero-length event is a point and overlaps when it sits inside the range.
  if (end.getTime() <= start.getTime()) {
    return (
      start.getTime() >= range.from.getTime() &&
      start.getTime() < range.to.getTime()
    );
  }
  return (
    start.getTime() < range.to.getTime() && end.getTime() > range.from.getTime()
  );
}

function toUtcDateKey(date: Date) {
  return formatDateKey(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}
