import type { CalendarPreferences } from "@/utils/calendar/preferences/preferences";
import {
  addDaysToDateKey,
  getDateKeyWeekday,
} from "@/utils/calendar/zoned-time";

type WeekStart = CalendarPreferences["weekStart"];

const WEEK_START_DAY: Record<WeekStart, number> = {
  sunday: 0,
  monday: 1,
  saturday: 6,
};

/** 0 = Sunday ... 6 = Saturday. */
export function getWeekStartDay(weekStart: WeekStart) {
  return WEEK_START_DAY[weekStart];
}

/** Weekday numbers in display order for the week start. */
export function getWeekdayOrder(weekStart: WeekStart) {
  const first = WEEK_START_DAY[weekStart];
  return Array.from({ length: 7 }, (_, index) => (first + index) % 7);
}

/** Date key of the first day of the week containing `dateKey`. */
export function startOfWeekKey(dateKey: string, weekStart: WeekStart) {
  const offset =
    (getDateKeyWeekday(dateKey) - WEEK_START_DAY[weekStart] + 7) % 7;
  return addDaysToDateKey(dateKey, -offset);
}

/** Seven date keys of the week containing `dateKey`. */
export function getWeekDateKeys(dateKey: string, weekStart: WeekStart) {
  const start = startOfWeekKey(dateKey, weekStart);
  return Array.from({ length: 7 }, (_, index) =>
    addDaysToDateKey(start, index),
  );
}

/**
 * Month grid range: whole weeks covering the month of `dateKey`. `endKey` is
 * the last day shown, inclusive.
 */
export function getMonthGridRange(dateKey: string, weekStart: WeekStart) {
  const firstOfMonth = `${dateKey.slice(0, 7)}-01`;
  const lastOfMonth = addDaysToDateKey(nextMonthStart(firstOfMonth), -1);
  return {
    startKey: startOfWeekKey(firstOfMonth, weekStart),
    endKey: addDaysToDateKey(startOfWeekKey(lastOfMonth, weekStart), 6),
  };
}

function nextMonthStart(firstOfMonth: string) {
  const year = Number(firstOfMonth.slice(0, 4));
  const month = Number(firstOfMonth.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
}
