import { z } from "zod";
import { isValidTimeZone } from "@/utils/calendar/zoned-time";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");
const instant = z.iso.datetime({ offset: true });

export const eventTimingSchema = z
  .discriminatedUnion("isAllDay", [
    z.object({
      isAllDay: z.literal(false),
      start: instant,
      end: instant,
      timeZone: z.string().refine(isValidTimeZone, "Invalid time zone"),
    }),
    z.object({
      isAllDay: z.literal(true),
      startDate: dateKey,
      /** Exclusive. */
      endDate: dateKey,
    }),
  ])
  .refine(
    (timing) =>
      timing.isAllDay
        ? timing.endDate > timing.startDate
        : new Date(timing.end) > new Date(timing.start),
    "End must be after start",
  );

const guestSchema = z.object({
  email: z.string().trim().email("Invalid email").max(320),
  name: z.string().trim().max(200).optional(),
});

export const remindersSchema = z.object({
  useDefault: z.boolean(),
  // Google accepts at most five overrides, up to four weeks ahead.
  overrides: z
    .array(
      z.object({
        method: z.enum(["popup", "email"]),
        minutes: z.number().int().min(0).max(40_320),
      }),
    )
    .max(5),
});

const sendUpdatesSchema = z.enum(["all", "externalOnly", "none"]);

const eventFields = {
  title: z.string().max(1024),
  description: z.string().max(8192),
  location: z.string().max(1024),
  timing: eventTimingSchema,
  guests: z.array(guestSchema).max(200),
  reminders: remindersSchema,
  addVideoConference: z.boolean(),
  sendUpdates: sendUpdatesSchema,
};

/** Database id of a Calendar plus the provider id of one of its events. */
const eventRef = {
  calendarId: z.string().min(1),
  providerEventId: z.string().min(1),
};

export const createCalendarEventBody = z.object({
  calendarId: z.string().min(1),
  title: eventFields.title,
  description: eventFields.description.optional(),
  location: eventFields.location.optional(),
  timing: eventFields.timing,
  guests: eventFields.guests.default([]),
  reminders: eventFields.reminders.optional(),
  addVideoConference: eventFields.addVideoConference.default(false),
  sendUpdates: eventFields.sendUpdates.optional(),
});
export type CreateCalendarEventBody = z.input<typeof createCalendarEventBody>;

export const updateCalendarEventBody = z.object({
  ...eventRef,
  title: eventFields.title.optional(),
  description: eventFields.description.optional(),
  location: eventFields.location.optional(),
  timing: eventFields.timing.optional(),
  guests: eventFields.guests.optional(),
  reminders: eventFields.reminders.optional(),
  addVideoConference: eventFields.addVideoConference.optional(),
  sendUpdates: eventFields.sendUpdates.optional(),
});
export type UpdateCalendarEventBody = z.input<typeof updateCalendarEventBody>;

export const moveCalendarEventBody = z.object({
  ...eventRef,
  /** ISO instant for a timed event, `YYYY-MM-DD` for an all-day one. */
  newStart: z.union([instant, dateKey]),
  sendUpdates: sendUpdatesSchema.optional(),
});
export type MoveCalendarEventBody = z.input<typeof moveCalendarEventBody>;

export const deleteCalendarEventBody = z.object({
  ...eventRef,
  sendUpdates: sendUpdatesSchema.optional(),
});
export type DeleteCalendarEventBody = z.input<typeof deleteCalendarEventBody>;

export const respondToCalendarEventBody = z.object({
  ...eventRef,
  response: z.enum(["accepted", "declined", "tentative"]),
  sendUpdates: sendUpdatesSchema.optional(),
});
export type RespondToCalendarEventBody = z.input<
  typeof respondToCalendarEventBody
>;

export const setCalendarEventRemindersBody = z.object({
  ...eventRef,
  reminders: remindersSchema,
});
export type SetCalendarEventRemindersBody = z.input<
  typeof setCalendarEventRemindersBody
>;
