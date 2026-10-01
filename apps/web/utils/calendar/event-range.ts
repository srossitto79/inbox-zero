import {
  addDaysToDateKey,
  diffDateKeys,
  formatDateKey,
  parseDateKey,
  startOfLocalDay,
  toDateKey,
  toWallClock,
} from "@/utils/calendar/zoned-time";
import type { CalendarPreferences } from "@/utils/calendar/preferences/preferences";
import {
  getMonthGridRange,
  getWeekDateKeys,
} from "@/utils/calendar/preferences/week-range";

export type CalendarViewType = "day" | "week" | "month" | "agenda";

/** Which day opens a week. Read from the calendar preferences. */
export type WeekStart = CalendarPreferences["weekStart"];

export const AGENDA_DAYS = 30;

/**
 * An event as the views see it. All-day events carry floating dates
 * (`YYYY-MM-DD`, end exclusive) that mean the same calendar days in every time
 * zone; timed events carry ISO instants.
 */
export type TimelineEvent = {
  id: string;
  isAllDay: boolean;
  start: string;
  end: string;
};

export function getVisibleDateKeys({
  view,
  anchorKey,
  weekStart,
}: {
  view: CalendarViewType;
  anchorKey: string;
  weekStart: WeekStart;
}): string[] {
  if (view === "day") return [anchorKey];
  if (view === "agenda") return getDateKeyRange(anchorKey, AGENDA_DAYS);
  if (view === "week") return getWeekDateKeys(anchorKey, weekStart);

  const { startKey, endKey } = getMonthGridRange(anchorKey, weekStart);
  return getDateKeyRange(startKey, diffDateKeys(startKey, endKey) + 1);
}

/** Instants spanning every visible day, for the events request. */
export function getRangeInstants(dateKeys: string[], timeZone: string) {
  return {
    from: startOfLocalDay(dateKeys[0], timeZone),
    to: startOfLocalDay(
      addDaysToDateKey(dateKeys.at(-1) as string, 1),
      timeZone,
    ),
  };
}

export function shiftAnchor({
  view,
  anchorKey,
  direction,
}: {
  view: CalendarViewType;
  anchorKey: string;
  direction: 1 | -1;
}): string {
  if (view === "day") return addDaysToDateKey(anchorKey, direction);
  if (view === "week") return addDaysToDateKey(anchorKey, direction * 7);
  if (view === "agenda") {
    return addDaysToDateKey(anchorKey, direction * AGENDA_DAYS);
  }

  const { year, month } = parseDateKey(anchorKey);
  const target = new Date(Date.UTC(year, month - 1 + direction, 1));
  return formatDateKey(target.getUTCFullYear(), target.getUTCMonth() + 1, 1);
}

/** Local days an event touches. Timed events ending at midnight stop the day before. */
export function getEventDateKeys(
  event: TimelineEvent,
  timeZone: string,
): string[] {
  if (event.isAllDay) {
    const days = Math.max(1, diffDateKeys(event.start, event.end));
    return getDateKeyRange(event.start, days);
  }

  const start = new Date(event.start);
  const end = new Date(event.end);
  const first = toDateKey(start, timeZone);
  // An event ending exactly at midnight does not occupy the next day.
  const lastInstant =
    end.getTime() > start.getTime() ? new Date(end.getTime() - 1) : end;
  const last = toDateKey(lastInstant, timeZone);
  return getDateKeyRange(first, diffDateKeys(first, last) + 1);
}

/**
 * Wall-clock minutes an event covers within one local day, clamped to the day.
 * Wall-clock minutes keep events aligned with the hour labels on days that
 * are 23 or 25 hours long.
 */
export function getDaySegment(
  event: TimelineEvent,
  dateKey: string,
  timeZone: string,
): { start: number; end: number } {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const startWall = toWallClock(start, timeZone);
  const endWall = toWallClock(end, timeZone);
  const startKey = formatDateKey(
    startWall.year,
    startWall.month,
    startWall.day,
  );
  const endKey = formatDateKey(endWall.year, endWall.month, endWall.day);

  const startMinutes =
    startKey < dateKey ? 0 : startWall.hour * 60 + startWall.minute;
  const endMinutes =
    endKey > dateKey ? 24 * 60 : endWall.hour * 60 + endWall.minute;

  return { start: startMinutes, end: Math.max(endMinutes, startMinutes) };
}

export function groupEventsByDay<T extends TimelineEvent>(
  events: T[],
  dateKeys: string[],
  timeZone: string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>(dateKeys.map((key) => [key, []]));
  for (const event of events) {
    for (const key of getEventDateKeys(event, timeZone)) {
      grouped.get(key)?.push(event);
    }
  }
  for (const list of grouped.values()) list.sort(compareEvents);
  return grouped;
}

/** All-day first, then by start time, then by title-independent id. */
export function compareEvents(a: TimelineEvent, b: TimelineEvent) {
  if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
  const byStart = a.start.localeCompare(b.start);
  if (byStart !== 0) return byStart;
  return a.id.localeCompare(b.id);
}

function getDateKeyRange(startKey: string, days: number) {
  return Array.from({ length: days }, (_, index) =>
    addDaysToDateKey(startKey, index),
  );
}
