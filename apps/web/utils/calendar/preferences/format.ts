import type { CalendarPreferences } from "@/utils/calendar/preferences/preferences";
import { toWallClock } from "@/utils/calendar/zoned-time";

type TimeFormat = CalendarPreferences["timeFormat"];

/** Clock time of an instant, such as "14:05" or "2:05 PM". */
export function formatClockTime({
  instant,
  timeZone,
  timeFormat,
}: {
  instant: Date;
  timeZone: string;
  timeFormat: TimeFormat;
}) {
  const wall = toWallClock(instant, timeZone);
  return formatMinutes(wall.hour * 60 + wall.minute, timeFormat);
}

/** Time-grid label for a whole hour (0-23), such as "14:00" or "2 PM". */
export function formatHourLabel(hour: number, timeFormat: TimeFormat) {
  if (timeFormat === "24h") return `${pad(hour)}:00`;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12} ${suffix}`;
}

/** Minutes after midnight as a clock time. */
export function formatMinutes(totalMinutes: number, timeFormat: TimeFormat) {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  if (timeFormat === "24h") return `${pad(hours)}:${pad(minutes)}`;
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 === 0 ? 12 : hours % 12}:${pad(minutes)} ${suffix}`;
}

/** Duration such as "30 min", "1 h" or "1 h 30 min". */
export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
