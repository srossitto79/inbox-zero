import { TZDate } from "@date-fns/tz";

export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Local date and time of an instant in a time zone. */
export function toWallClock(instant: Date, timeZone: string): WallClock {
  const zoned = new TZDate(instant.getTime(), timeZone);
  return {
    year: zoned.getFullYear(),
    month: zoned.getMonth() + 1,
    day: zoned.getDate(),
    hour: zoned.getHours(),
    minute: zoned.getMinutes(),
    second: zoned.getSeconds(),
  };
}

/**
 * The instant at which a time zone's clock shows the given wall time. A time
 * skipped by a spring-forward gap resolves to the same wall time after the
 * gap, and an ambiguous autumn time resolves to its first occurrence.
 */
export function wallClockToInstant(wall: WallClock, timeZone: string): Date {
  return new Date(
    new TZDate(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
      0,
      timeZone,
    ).getTime(),
  );
}

/** `YYYY-MM-DD` of an instant in a time zone. */
export function toDateKey(instant: Date, timeZone: string): string {
  const wall = toWallClock(instant, timeZone);
  return formatDateKey(wall.year, wall.month, wall.day);
}

/** First instant of a local calendar day. DST days are 23 or 25 hours long. */
export function startOfLocalDay(dateKey: string, timeZone: string): Date {
  const { year, month, day } = parseDateKey(dateKey);
  return wallClockToInstant(
    { year, month, day, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

export function parseDateKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`Invalid date key: ${dateKey}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function formatDateKey(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Calendar-date arithmetic, independent of any time zone. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const { year, month, day } = parseDateKey(dateKey);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatDateKey(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** 0 = Sunday ... 6 = Saturday. */
export function getDateKeyWeekday(dateKey: string): number {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function diffDateKeys(from: string, to: string): number {
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) -
      Date.UTC(a.year, a.month - 1, a.day)) /
      86_400_000,
  );
}

export function isValidTimeZone(timeZone: string | null | undefined) {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
