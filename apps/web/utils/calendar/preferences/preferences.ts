import { z } from "zod";
import { isValidTimeZone } from "@/utils/calendar/zoned-time";

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const calendarPreferencesSchema = z.object({
  weekStart: z.enum(["monday", "sunday", "saturday"]),
  // 0 = Sunday ... 6 = Saturday
  workingDays: z.array(z.number().int().min(0).max(6)).max(7),
  workingHours: z.object({ start: timeOfDay, end: timeOfDay }),
  secondaryTimeZone: z
    .string()
    .refine(isValidTimeZone, "Invalid time zone")
    .nullable(),
  defaultView: z.enum(["day", "week", "month", "agenda"]),
  timeFormat: z.enum(["12h", "24h"]),
  density: z.enum(["comfortable", "compact"]),
  defaultDurationMinutes: z.number().int().min(5).max(1440),
  defaultReminderMinutes: z.number().int().min(0).max(40_320).nullable(),
});

export type CalendarPreferences = z.infer<typeof calendarPreferencesSchema>;

export const DEFAULT_CALENDAR_PREFERENCES: CalendarPreferences = {
  weekStart: "monday",
  workingDays: [1, 2, 3, 4, 5],
  workingHours: { start: "09:00", end: "17:00" },
  secondaryTimeZone: null,
  defaultView: "week",
  timeFormat: "24h",
  density: "comfortable",
  defaultDurationMinutes: 30,
  defaultReminderMinutes: null,
};

/**
 * Stored settings merged over the defaults. A key that no longer validates
 * falls back on its own, so one bad value never discards the others.
 */
export function resolveCalendarPreferences(
  stored: unknown,
): CalendarPreferences {
  const result: Record<string, unknown> = { ...DEFAULT_CALENDAR_PREFERENCES };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return result as CalendarPreferences;
  }

  const shape = calendarPreferencesSchema.shape;
  for (const key of Object.keys(shape) as (keyof CalendarPreferences)[]) {
    if (!(key in stored)) continue;
    const parsed = shape[key].safeParse(
      (stored as Record<string, unknown>)[key],
    );
    if (parsed.success) result[key] = parsed.data;
  }

  const merged = result as CalendarPreferences;
  if (
    toMinutes(merged.workingHours.end) <= toMinutes(merged.workingHours.start)
  ) {
    merged.workingHours = DEFAULT_CALENDAR_PREFERENCES.workingHours;
  }
  return merged;
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
