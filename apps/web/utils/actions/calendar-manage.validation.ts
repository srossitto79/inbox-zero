import { z } from "zod";
import { CALENDAR_COLOR_VALUES } from "@/utils/calendar/manage/colors";
import { isValidTimeZone } from "@/utils/calendar/zoned-time";

const calendarName = z.string().trim().min(1, "Name is required").max(100);
const calendarDescription = z.string().trim().max(1000);
const calendarTimeZone = z
  .string()
  .refine(isValidTimeZone, "Invalid time zone");
const calendarColor = z.enum(CALENDAR_COLOR_VALUES);

export const createCalendarBody = z.object({
  connectionId: z.string().min(1),
  name: calendarName,
  description: calendarDescription.optional(),
  timeZone: calendarTimeZone.optional(),
  color: calendarColor.optional(),
});
export type CreateCalendarBody = z.infer<typeof createCalendarBody>;

export const updateCalendarBody = z
  .object({
    calendarId: z.string().min(1),
    name: calendarName.optional(),
    description: calendarDescription.optional(),
    timeZone: calendarTimeZone.optional(),
  })
  .refine(
    ({ name, description, timeZone }) =>
      name !== undefined || description !== undefined || timeZone !== undefined,
    { message: "Nothing to change" },
  );
export type UpdateCalendarBody = z.infer<typeof updateCalendarBody>;

export const setCalendarColorBody = z.object({
  calendarId: z.string().min(1),
  color: calendarColor,
});
export type SetCalendarColorBody = z.infer<typeof setCalendarColorBody>;

export const setCalendarsVisibilityBody = z.object({
  changes: z
    .array(z.object({ calendarId: z.string().min(1), isEnabled: z.boolean() }))
    .min(1)
    .max(100),
});
export type SetCalendarsVisibilityBody = z.infer<
  typeof setCalendarsVisibilityBody
>;

export const deleteCalendarBody = z.object({
  calendarId: z.string().min(1),
});
export type DeleteCalendarBody = z.infer<typeof deleteCalendarBody>;
