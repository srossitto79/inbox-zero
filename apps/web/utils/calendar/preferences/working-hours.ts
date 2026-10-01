import type { CalendarPreferences } from "@/utils/calendar/preferences/preferences";
import { toWallClock } from "@/utils/calendar/zoned-time";

export type WorkingSchedule = Pick<
  CalendarPreferences,
  "workingDays" | "workingHours"
>;

/** Minutes after midnight for an `HH:mm` string. */
export function parseTimeOfDay(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Whether the instant falls inside working hours on a working day, judged on
 * the wall clock of `timeZone`. The end of the range is exclusive.
 */
export function isWorkingHour({
  instant,
  timeZone,
  schedule,
}: {
  instant: Date;
  timeZone: string;
  schedule: WorkingSchedule;
}) {
  const wall = toWallClock(instant, timeZone);
  const weekday = new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day),
  ).getUTCDay();
  if (!schedule.workingDays.includes(weekday)) return false;

  const minutes = wall.hour * 60 + wall.minute;
  return (
    minutes >= parseTimeOfDay(schedule.workingHours.start) &&
    minutes < parseTimeOfDay(schedule.workingHours.end)
  );
}
