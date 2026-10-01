import ICAL from "ical.js";
import {
  formatDateKey,
  isValidTimeZone,
  toWallClock,
  type WallClock,
  wallClockToInstant,
} from "@/utils/calendar/zoned-time";

// Google series are stored as a master plus exceptions and expanded here, at
// read time. Expanding at sync time (Google's singleEvents=true) would be
// simpler to render, but Google refuses to combine singleEvents with an
// unbounded syncToken window, would store thousands of rows for a daily
// series, and loses the master that "edit this and following" has to split.
// The cost is this expander, which has to honour the master's own time zone
// so a 09:00 meeting stays at 09:00 across a DST change.

const MAX_RECURRENCE_ITERATIONS = 20_000;

export type RecurringMaster = {
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  timezone: string | null;
  recurrence: string[];
};

export type RecurrenceOccurrence = {
  startTime: Date;
  endTime: Date;
  /** The slot this occurrence fills; exceptions refer to it by slot key. */
  originalStartTime: Date;
  slotKey: string;
};

/**
 * Occurrences of a series that overlap `range`, with EXDATEs already removed.
 * Exceptions are applied by the caller through `slotKey`.
 */
export function expandRecurringEvent(
  master: RecurringMaster,
  range: { from: Date; to: Date },
): RecurrenceOccurrence[] {
  const timeZone = resolveTimeZone(master.timezone);
  const durationMs = master.endTime.getTime() - master.startTime.getTime();
  const rules = parseRecurrenceLines(master.recurrence, {
    isAllDay: master.isAllDay,
    timeZone,
  });
  const startWall = master.isAllDay
    ? wallFromUtcDate(master.startTime)
    : toWallClock(master.startTime, timeZone);

  const found = new Map<string, RecurrenceOccurrence>();
  const consider = (wall: WallClock): "continue" | "stop" => {
    const key = getSlotKeyFromWall(wall, master.isAllDay);
    if (found.has(key) || rules.exdates.has(key)) return "continue";
    const startTime = master.isAllDay
      ? utcDateFromWall(wall)
      : wallClockToInstant(wall, timeZone);
    if (startTime.getTime() >= range.to.getTime()) return "stop";
    const endTime = new Date(startTime.getTime() + durationMs);
    if (endTime.getTime() > range.from.getTime()) {
      found.set(key, {
        startTime,
        endTime,
        originalStartTime: startTime,
        slotKey: key,
      });
    }
    return "continue";
  };

  for (const rule of rules.rrules) {
    const iterator = ICAL.Recur.fromString(rule).iterator(
      new ICAL.Time(
        {
          year: startWall.year,
          month: startWall.month,
          day: startWall.day,
          hour: startWall.hour,
          minute: startWall.minute,
          second: startWall.second,
          isDate: master.isAllDay,
        },
        ICAL.Timezone.localTimezone,
      ),
    );
    let iterations = 0;
    let next = iterator.next();
    while (next && iterations < MAX_RECURRENCE_ITERATIONS) {
      iterations += 1;
      const result = consider({
        year: next.year,
        month: next.month,
        day: next.day,
        hour: next.hour,
        minute: next.minute,
        second: next.second,
      });
      if (result === "stop") break;
      next = iterator.next();
    }
  }

  for (const wall of rules.rdates) consider(wall);
  // A series with only RDATEs still occurs at its own start.
  if (rules.rrules.length === 0) consider(startWall);

  return [...found.values()].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime(),
  );
}

/** Key shared by an occurrence and the exception that replaces it. */
export function getSlotKey({
  instant,
  timeZone,
  isAllDay,
}: {
  instant: Date;
  timeZone: string | null;
  isAllDay: boolean;
}) {
  const wall = isAllDay
    ? wallFromUtcDate(instant)
    : toWallClock(instant, resolveTimeZone(timeZone));
  return getSlotKeyFromWall(wall, isAllDay);
}

type ParsedRecurrence = {
  rrules: string[];
  exdates: Set<string>;
  rdates: WallClock[];
};

function parseRecurrenceLines(
  lines: string[],
  { isAllDay, timeZone }: { isAllDay: boolean; timeZone: string },
): ParsedRecurrence {
  const parsed: ParsedRecurrence = {
    rrules: [],
    exdates: new Set(),
    rdates: [],
  };

  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const head = line.slice(0, separator);
    const body = line.slice(separator + 1);
    const name = head.split(";")[0].toUpperCase();

    if (name === "RRULE") {
      parsed.rrules.push(normalizeUntil(body, { isAllDay, timeZone }));
      continue;
    }

    // EXRULE is deprecated and ignored by Google and Outlook.
    if (name !== "EXDATE" && name !== "RDATE") continue;

    const sourceZone = /TZID=([^;:]+)/i.exec(head)?.[1] ?? timeZone;
    for (const value of body.split(",")) {
      const wall = parseRecurrenceDate(value.trim(), {
        isAllDay,
        timeZone,
        sourceZone,
      });
      if (!wall) continue;
      if (name === "EXDATE")
        parsed.exdates.add(getSlotKeyFromWall(wall, isAllDay));
      else parsed.rdates.push(wall);
    }
  }

  return parsed;
}

function parseRecurrenceDate(
  value: string,
  {
    isAllDay,
    timeZone,
    sourceZone,
  }: { isAllDay: boolean; timeZone: string; sourceZone: string },
): WallClock | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(
    value,
  );
  if (!match) return null;
  const wall: WallClock = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
  };
  if (isAllDay) return { ...wall, hour: 0, minute: 0, second: 0 };
  // A date-only value cannot name a time of day on a timed event.
  if (match[4] === undefined) return null;

  const instant =
    match[7] === "Z"
      ? new Date(
          Date.UTC(
            wall.year,
            wall.month - 1,
            wall.day,
            wall.hour,
            wall.minute,
            wall.second,
          ),
        )
      : wallClockToInstant(wall, resolveTimeZone(sourceZone, timeZone));
  return toWallClock(instant, timeZone);
}

/**
 * RRULE UNTIL is usually UTC, but the iterator walks local wall-clock times,
 * so a UTC bound would cut the last occurrence off (or add one) by the zone
 * offset.
 */
function normalizeUntil(
  rule: string,
  { isAllDay, timeZone }: { isAllDay: boolean; timeZone: string },
) {
  return rule.replace(
    /UNTIL=(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/i,
    (
      _match,
      year: string,
      month: string,
      day: string,
      hour?: string,
      minute?: string,
      second?: string,
      utc?: string,
    ) => {
      if (isAllDay) return `UNTIL=${year}${month}${day}`;
      if (hour === undefined) return `UNTIL=${year}${month}${day}T235959`;
      if (utc !== "Z") {
        return `UNTIL=${year}${month}${day}T${hour}${minute}${second}`;
      }
      const wall = toWallClock(
        new Date(
          Date.UTC(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(minute),
            Number(second),
          ),
        ),
        timeZone,
      );
      return `UNTIL=${getSlotKeyFromWall(wall, false)}`;
    },
  );
}

function getSlotKeyFromWall(wall: WallClock, isAllDay: boolean) {
  const date = formatDateKey(wall.year, wall.month, wall.day).replaceAll(
    "-",
    "",
  );
  if (isAllDay) return date;
  return `${date}T${pad(wall.hour)}${pad(wall.minute)}${pad(wall.second)}`;
}

function resolveTimeZone(timeZone: string | null, fallback = "UTC") {
  return isValidTimeZone(timeZone) ? (timeZone as string) : fallback;
}

function wallFromUtcDate(date: Date): WallClock {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

function utcDateFromWall(wall: WallClock) {
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
