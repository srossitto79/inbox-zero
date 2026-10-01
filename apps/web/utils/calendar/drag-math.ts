import {
  addDaysToDateKey,
  diffDateKeys,
  formatDateKey,
  toDateKey,
  toWallClock,
  wallClockToInstant,
} from "@/utils/calendar/zoned-time";

export const SNAP_MINUTES = 15;
export const MINUTES_PER_DAY = 24 * 60;
export const DEFAULT_EVENT_MINUTES = 60;

/**
 * Time arithmetic for moving, resizing and creating events on the grid.
 * Positions are wall-clock minutes of a local day, because that is what the
 * grid draws; instants are only produced at the end, so a drag across a DST
 * change lands on the clock time the user pointed at.
 */

export function snapMinutes(minutes: number, step = SNAP_MINUTES) {
  return Math.round(minutes / step) * step;
}

/** Minutes from the top of a day column for a pointer position. */
export function pixelsToMinutes({
  pointerY,
  columnTop,
  hourHeight,
}: {
  pointerY: number;
  columnTop: number;
  hourHeight: number;
}) {
  const minutes = ((pointerY - columnTop) / hourHeight) * 60;
  return Math.min(MINUTES_PER_DAY, Math.max(0, minutes));
}

/** Index of the column under `x`, clamped to the first and last column. */
export function findColumnIndex(
  x: number,
  bounds: Array<{ left: number; right: number }>,
) {
  const hit = bounds.findIndex(({ left, right }) => x >= left && x < right);
  if (hit !== -1) return hit;
  if (bounds.length === 0) return -1;
  return x < bounds[0].left ? 0 : bounds.length - 1;
}

/** The instant at `minutes` after local midnight of `dateKey`; may overflow into later days. */
export function minutesToInstant(
  dateKey: string,
  minutes: number,
  timeZone: string,
) {
  const dayShift = Math.floor(minutes / MINUTES_PER_DAY);
  const inDay = minutes - dayShift * MINUTES_PER_DAY;
  const [year, month, day] = addDaysToDateKey(dateKey, dayShift)
    .split("-")
    .map(Number);
  return wallClockToInstant(
    {
      year,
      month,
      day,
      hour: Math.floor(inDay / 60),
      minute: inDay % 60,
      second: 0,
    },
    timeZone,
  );
}

/**
 * Range selected by dragging from one point of a day column to another, in
 * either direction. The start snaps down and the end snaps up so the whole
 * dragged area is covered; the range is never shorter than one snap step.
 */
export function computeCreateRange({
  dateKey,
  anchorMinutes,
  currentMinutes,
  timeZone,
}: {
  dateKey: string;
  anchorMinutes: number;
  currentMinutes: number;
  timeZone: string;
}) {
  const { start, end } = computeCreateRangeMinutes(
    anchorMinutes,
    currentMinutes,
  );
  return {
    start: minutesToInstant(dateKey, start, timeZone),
    end: minutesToInstant(dateKey, end, timeZone),
  };
}

/** The dragged range as minutes of the day, for drawing the preview. */
export function computeCreateRangeMinutes(
  anchorMinutes: number,
  currentMinutes: number,
) {
  const low = Math.min(anchorMinutes, currentMinutes);
  const high = Math.max(anchorMinutes, currentMinutes);
  let start = Math.floor(low / SNAP_MINUTES) * SNAP_MINUTES;
  let end = Math.ceil(high / SNAP_MINUTES) * SNAP_MINUTES;
  if (end - start < SNAP_MINUTES) end = start + SNAP_MINUTES;
  if (end > MINUTES_PER_DAY) {
    end = MINUTES_PER_DAY;
    start = Math.min(start, MINUTES_PER_DAY - SNAP_MINUTES);
  }
  return { start, end };
}

/** A click on an empty slot: the slot's start with the default length. */
export function computeClickSlot({
  dateKey,
  minutes,
  timeZone,
  durationMinutes = DEFAULT_EVENT_MINUTES,
}: {
  dateKey: string;
  minutes: number;
  timeZone: string;
  durationMinutes?: number;
}) {
  const start = Math.min(
    Math.floor(minutes / SNAP_MINUTES) * SNAP_MINUTES,
    MINUTES_PER_DAY - SNAP_MINUTES,
  );
  const startInstant = minutesToInstant(dateKey, start, timeZone);
  return {
    start: startInstant,
    end: new Date(startInstant.getTime() + durationMinutes * 60_000),
  };
}

/**
 * Moves a timed event by `deltaMinutes` of wall-clock time (negative moves it
 * earlier, a multiple of 1440 moves it whole days). The new start snaps to the
 * grid and the event keeps its elapsed length. No movement returns the event
 * untouched, so an off-grid start is not nudged by a click.
 */
export function moveTimedEvent({
  start,
  end,
  timeZone,
  deltaMinutes,
}: {
  start: Date;
  end: Date;
  timeZone: string;
  deltaMinutes: number;
}) {
  if (deltaMinutes === 0) return { start, end };
  const startDayKey = toDateKey(start, timeZone);
  const wall = toWallClock(start, timeZone);
  const minuteOfDay = wall.hour * 60 + wall.minute;
  const target = snapMinutes(minuteOfDay + deltaMinutes);
  const newStart = minutesToInstant(startDayKey, target, timeZone);
  return {
    start: newStart,
    end: new Date(newStart.getTime() + (end.getTime() - start.getTime())),
  };
}

/**
 * Drags the bottom edge: the end moves by `deltaMinutes` of wall-clock time and
 * snaps to the grid, never closer than one snap step to the start.
 */
export function resizeTimedEvent({
  start,
  end,
  timeZone,
  deltaMinutes,
}: {
  start: Date;
  end: Date;
  timeZone: string;
  deltaMinutes: number;
}) {
  if (deltaMinutes === 0) return { start, end };
  const referenceKey = toDateKey(start, timeZone);
  const endWall = toWallClock(end, timeZone);
  const endKey = formatDateKey(endWall.year, endWall.month, endWall.day);
  const endMinutes =
    diffDateKeys(referenceKey, endKey) * MINUTES_PER_DAY +
    endWall.hour * 60 +
    endWall.minute;
  const newEnd = minutesToInstant(
    referenceKey,
    snapMinutes(endMinutes + deltaMinutes),
    timeZone,
  );
  const earliest = new Date(start.getTime() + SNAP_MINUTES * 60_000);
  return { start, end: newEnd < earliest ? earliest : newEnd };
}

/**
 * Month view: moves an event by whole days. A timed event keeps its clock
 * time (an event at 09:00 stays at 09:00 across a DST change) and its elapsed
 * length; an all-day event keeps its number of days.
 */
export function moveEventByDays({
  event,
  dayDelta,
  timeZone,
}: {
  event:
    | { isAllDay: true; startDate: string; endDate: string }
    | { isAllDay: false; start: Date; end: Date };
  dayDelta: number;
  timeZone: string;
}) {
  if (event.isAllDay) {
    return {
      isAllDay: true as const,
      startDate: addDaysToDateKey(event.startDate, dayDelta),
      endDate: addDaysToDateKey(event.endDate, dayDelta),
    };
  }
  const startWall = toWallClock(event.start, timeZone);
  const startKey = formatDateKey(
    startWall.year,
    startWall.month,
    startWall.day,
  );
  const newStart = minutesToInstant(
    addDaysToDateKey(startKey, dayDelta),
    startWall.hour * 60 + startWall.minute,
    timeZone,
  );
  return {
    isAllDay: false as const,
    start: newStart,
    end: new Date(
      newStart.getTime() + (event.end.getTime() - event.start.getTime()),
    ),
  };
}
