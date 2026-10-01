import type { EventTiming } from "@/utils/calendar/write/types";
import {
  addDaysToDateKey,
  diffDateKeys,
  isValidTimeZone,
  parseDateKey,
} from "@/utils/calendar/zoned-time";

/**
 * Moves an event to a new start and keeps its length: the same elapsed time
 * for a timed event (an hour stays an hour across a DST change) and the same
 * number of days for an all-day one.
 */
export function shiftTiming(
  current: EventTiming,
  newStart: Date | string,
): EventTiming {
  if (current.isAllDay) {
    if (typeof newStart !== "string") {
      throw new Error("An all-day event moves to a date");
    }
    const days = diffDateKeys(current.startDate, current.endDate);
    return {
      isAllDay: true,
      startDate: newStart,
      endDate: addDaysToDateKey(newStart, days),
    };
  }
  if (typeof newStart === "string") {
    throw new Error("A timed event moves to an instant");
  }
  return {
    isAllDay: false,
    start: newStart,
    end: new Date(
      newStart.getTime() + (current.end.getTime() - current.start.getTime()),
    ),
    timeZone: current.timeZone,
  };
}

/** Returns a user-facing problem, or null when the timing is usable. */
export function getTimingProblem(timing: EventTiming): string | null {
  if (timing.isAllDay) {
    try {
      parseDateKey(timing.startDate);
      parseDateKey(timing.endDate);
    } catch {
      return "Invalid date";
    }
    return timing.endDate > timing.startDate ? null : "End must be after start";
  }
  if (
    Number.isNaN(timing.start.getTime()) ||
    Number.isNaN(timing.end.getTime())
  ) {
    return "Invalid date";
  }
  if (!isValidTimeZone(timing.timeZone)) return "Invalid time zone";
  return timing.end.getTime() > timing.start.getTime()
    ? null
    : "End must be after start";
}
