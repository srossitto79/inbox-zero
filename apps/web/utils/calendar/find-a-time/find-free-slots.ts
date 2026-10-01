import {
  addDaysToDateKey,
  diffDateKeys,
  startOfLocalDay,
  toDateKey,
  wallClockToInstant,
} from "@/utils/calendar/zoned-time";
import {
  isWorkingHour,
  parseTimeOfDay,
} from "@/utils/calendar/preferences/working-hours";

const MINUTE_MS = 60_000;
const MAX_WINDOW_DAYS = 62;

/**
 * Busy time of one person. An all-day entry blocks whole local days of the
 * search time zone; `endDate` is exclusive, like the calendar API.
 */
export type BusyInterval =
  | { start: Date; end: Date }
  | { allDay: true; startDate: string; endDate: string };

export type WorkingSchedule = {
  /** 0 = Sunday ... 6 = Saturday */
  workingDays: number[];
  workingHours: { start: string; end: string };
};

export type FreeSlot = {
  start: Date;
  end: Date;
  /** Lower ranks first. */
  score: number;
  /** Busy periods that begin where the slot ends or end where it begins. */
  backToBack: number;
  /** People (other than the searcher) whose working hours do not contain the slot. */
  outsideWorkingHours: string[];
};

type Span = { start: number; end: number };

/**
 * Ranked meeting slots that are free for everybody in `busyByPerson`.
 *
 * Ranking: slots inside everybody's working hours first, then earlier days,
 * then fewer back-to-back neighbours, then earlier in the day. Slots that
 * overlap a better ranked slot are dropped so the list offers distinct options.
 * People without busy data must be left out by the caller, never passed as
 * empty: an empty list means free.
 */
export function findFreeSlots({
  busyByPerson,
  window,
  durationMinutes,
  schedule,
  timeZone,
  participantTimeZones = {},
  granularityMinutes = 15,
  limit = 10,
  includeOutsideWorkingHours = false,
}: {
  busyByPerson: Record<string, BusyInterval[]>;
  window: { start: Date; end: Date };
  durationMinutes: number;
  schedule: WorkingSchedule;
  /** Time zone of the person searching; their working hours bound the search. */
  timeZone: string;
  /** Other time zones by person; a slot outside their working hours ranks lower. */
  participantTimeZones?: Record<string, string>;
  granularityMinutes?: number;
  limit?: number;
  includeOutsideWorkingHours?: boolean;
}): FreeSlot[] {
  if (
    !(durationMinutes > 0) ||
    !(granularityMinutes > 0) ||
    limit < 1 ||
    window.end.getTime() <= window.start.getTime()
  ) {
    return [];
  }

  const durationMs = durationMinutes * MINUTE_MS;
  const stepMs = granularityMinutes * MINUTE_MS;
  const busy = mergeSpans(
    Object.values(busyByPerson).flatMap((intervals) =>
      intervals.flatMap((interval) => toSpans(interval, timeZone)),
    ),
  );

  const firstDay = toDateKey(window.start, timeZone);
  const lastDay = toDateKey(new Date(window.end.getTime() - 1), timeZone);
  const dayCount = Math.min(
    diffDateKeys(firstDay, lastDay) + 1,
    MAX_WINDOW_DAYS,
  );

  const candidates: FreeSlot[] = [];
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const bounds = getSearchBounds({
      dateKey: addDaysToDateKey(firstDay, dayIndex),
      timeZone,
      schedule,
      includeOutsideWorkingHours,
    });
    if (!bounds) continue;

    const from = Math.max(bounds.start, window.start.getTime());
    const to = Math.min(bounds.end, window.end.getTime());

    for (const gap of freeGaps(busy, from, to)) {
      let start = alignUp(gap.start, bounds.start, stepMs);
      for (; start + durationMs <= gap.end; start += stepMs) {
        candidates.push(
          buildSlot({
            span: { start, end: start + durationMs },
            dayIndex,
            dayStart: bounds.start,
            busy,
            people: Object.keys(busyByPerson),
            timeZone,
            schedule,
            participantTimeZones,
          }),
        );
      }
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  const chosen: FreeSlot[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= limit) break;
    const overlaps = chosen.some(
      (slot) => candidate.start < slot.end && candidate.end > slot.start,
    );
    if (!overlaps) chosen.push(candidate);
  }
  return chosen;
}

function buildSlot({
  span,
  dayIndex,
  dayStart,
  busy,
  people,
  timeZone,
  schedule,
  participantTimeZones,
}: {
  span: Span;
  dayIndex: number;
  dayStart: number;
  busy: Span[];
  people: string[];
  timeZone: string;
  schedule: WorkingSchedule;
  participantTimeZones: Record<string, string>;
}): FreeSlot {
  const outsideWorkingHours = people.filter((person) => {
    const zone = participantTimeZones[person];
    return zone && !spanInWorkingHours({ span, timeZone: zone, schedule });
  });
  const searcherOutside = !spanInWorkingHours({ span, timeZone, schedule });
  const backToBack = busy.filter(
    (interval) => interval.end === span.start || interval.start === span.end,
  ).length;
  const minutesIntoDay = Math.max(0, (span.start - dayStart) / MINUTE_MS);

  // Each criterion outweighs everything after it: a day is below 1e4 minutes.
  const score =
    (searcherOutside ? 1e10 : 0) +
    outsideWorkingHours.length * 1e9 +
    dayIndex * 1e6 +
    Math.min(backToBack, 2) * 1e4 +
    minutesIntoDay;

  return {
    start: new Date(span.start),
    end: new Date(span.end),
    score,
    backToBack,
    outsideWorkingHours,
  };
}

function spanInWorkingHours({
  span,
  timeZone,
  schedule,
}: {
  span: Span;
  timeZone: string;
  schedule: WorkingSchedule;
}) {
  // The end instant is exclusive in isWorkingHour, so test the last minute.
  return (
    isWorkingHour({ instant: new Date(span.start), timeZone, schedule }) &&
    isWorkingHour({
      instant: new Date(span.end - MINUTE_MS),
      timeZone,
      schedule,
    })
  );
}

function getSearchBounds({
  dateKey,
  timeZone,
  schedule,
  includeOutsideWorkingHours,
}: {
  dateKey: string;
  timeZone: string;
  schedule: WorkingSchedule;
  includeOutsideWorkingHours: boolean;
}): Span | null {
  if (includeOutsideWorkingHours) {
    return {
      start: startOfLocalDay(dateKey, timeZone).getTime(),
      end: startOfLocalDay(addDaysToDateKey(dateKey, 1), timeZone).getTime(),
    };
  }

  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  if (!schedule.workingDays.includes(weekday)) return null;

  const [year, month, day] = dateKey.split("-").map(Number);
  const at = (time: string) => {
    const minutes = parseTimeOfDay(time);
    return wallClockToInstant(
      {
        year,
        month,
        day,
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
        second: 0,
      },
      timeZone,
    ).getTime();
  };
  const start = at(schedule.workingHours.start);
  const end = at(schedule.workingHours.end);
  return end > start ? { start, end } : null;
}

function toSpans(interval: BusyInterval, timeZone: string): Span[] {
  const span =
    "allDay" in interval
      ? {
          start: startOfLocalDay(interval.startDate, timeZone).getTime(),
          end: startOfLocalDay(interval.endDate, timeZone).getTime(),
        }
      : { start: interval.start.getTime(), end: interval.end.getTime() };
  return span.end > span.start ? [span] : [];
}

function mergeSpans(spans: Span[]) {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function freeGaps(busy: Span[], from: number, to: number) {
  const gaps: Span[] = [];
  let cursor = from;
  for (const interval of busy) {
    if (interval.end <= cursor) continue;
    if (interval.start >= to) break;
    if (interval.start > cursor) {
      gaps.push({ start: cursor, end: interval.start });
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < to) gaps.push({ start: cursor, end: to });
  return gaps;
}

/** First grid point at or after `value`; the grid starts at `origin`. */
function alignUp(value: number, origin: number, step: number) {
  if (value <= origin) return origin;
  return origin + Math.ceil((value - origin) / step) * step;
}
