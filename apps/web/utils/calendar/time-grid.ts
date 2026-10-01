import type { CalendarPreferences } from "@/utils/calendar/preferences/preferences";
import {
  isWorkingHour,
  type WorkingSchedule,
} from "@/utils/calendar/preferences/working-hours";
import { formatHourLabel } from "@/utils/calendar/preferences/format";
import { minutesToInstant } from "@/utils/calendar/drag-math";
import { toWallClock } from "@/utils/calendar/zoned-time";

type GridDensity = CalendarPreferences["density"];

const HOUR_HEIGHT: Record<GridDensity, number> = {
  comfortable: 64,
  compact: 48,
};

export const HOURS_PER_DAY = 24;

/** Height of one hour row, in pixels. Drag math divides by the same number. */
export function getHourHeight(density: GridDensity) {
  return HOUR_HEIGHT[density];
}

/** Height of a month cell. */
export function getMonthCellHeight(density: GridDensity) {
  return density === "compact" ? "min-h-20" : "min-h-28";
}

/**
 * Per-hour working flag for a day column, judged at the middle of the hour so
 * a boundary hour is shaded on the side it mostly covers.
 */
export function getWorkingHourFlags({
  dateKey,
  timeZone,
  schedule,
}: {
  dateKey: string;
  timeZone: string;
  schedule: WorkingSchedule;
}): boolean[] {
  return Array.from({ length: HOURS_PER_DAY }, (_, hour) =>
    isWorkingHour({
      instant: minutesToInstant(dateKey, hour * 60 + 30, timeZone),
      timeZone,
      schedule,
    }),
  );
}

/**
 * The hour gutter's labels translated into the secondary time zone. Indexed by
 * the primary zone's hour, so a label sits on the row it lines up with.
 */
export function getSecondaryHourLabels({
  dateKey,
  primaryTimeZone,
  secondaryTimeZone,
  timeFormat,
}: {
  dateKey: string;
  primaryTimeZone: string;
  secondaryTimeZone: string;
  timeFormat: CalendarPreferences["timeFormat"];
}): string[] {
  return Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
    const instant = minutesToInstant(dateKey, hour * 60, primaryTimeZone);
    const wall = toWallClock(instant, secondaryTimeZone);
    return formatHourLabel(wall.hour, timeFormat);
  });
}
