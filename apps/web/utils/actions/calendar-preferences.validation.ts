import type { z } from "zod";
import { calendarPreferencesSchema } from "@/utils/calendar/preferences/preferences";

export const updateCalendarPreferencesBody = calendarPreferencesSchema
  .partial()
  .strict();
export type UpdateCalendarPreferencesBody = z.infer<
  typeof updateCalendarPreferencesBody
>;
