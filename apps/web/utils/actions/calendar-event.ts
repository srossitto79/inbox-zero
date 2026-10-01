"use server";

import type { CalendarEvent } from "@/generated/prisma/client";
import { actionClient } from "@/utils/actions/safe-action";
import {
  createCalendarEventBody,
  deleteCalendarEventBody,
  moveCalendarEventBody,
  respondToCalendarEventBody,
  setCalendarEventRemindersBody,
  updateCalendarEventBody,
  type CreateCalendarEventBody,
} from "@/utils/actions/calendar-event.validation";
import { getCalendarConnectionState } from "@/utils/calendar/connection-scopes";
import { parseAttendees, toViewEvent } from "@/utils/calendar/expand-events";
import { newGoogleEventId } from "@/utils/calendar/write/google-writer";
import { getCalendarEventWriter } from "@/utils/calendar/write/get-event-writer";
import {
  createEventLocalFirst,
  deleteEventLocalFirst,
  moveEventLocalFirst,
  respondToEventLocalFirst,
  setRemindersLocalFirst,
  updateEventLocalFirst,
  type LocalWriteResult,
} from "@/utils/calendar/write/local-first";
import {
  composeGuests,
  getWriteBlock,
  getWriteBlockMessage,
  hasOtherGuests,
  resolveSendUpdates,
} from "@/utils/calendar/write/policy";
import type { EventReminders, EventTiming } from "@/utils/calendar/write/types";
import { SafeError } from "@/utils/error";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";

export const createCalendarEventAction = actionClient
  .metadata({ name: "createCalendarEvent" })
  .inputSchema(createCalendarEventBody)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { calendarId, guests, ...input },
    }) => {
      const target = await loadWritableCalendar({
        emailAccountId,
        calendarId,
        logger,
      });
      const result = await createEventLocalFirst({
        writer: target.writer,
        calendar: target.ref,
        organizerEmail: target.organizerEmail,
        providerEventId: newGoogleEventId(),
        input: {
          title: input.title,
          description: input.description,
          location: input.location,
          timing: toEventTiming(input.timing),
          guests: dedupeGuests(guests),
          reminders: input.reminders && toReminders(input.reminders),
          addVideoConference: input.addVideoConference,
          sendUpdates: resolveSendUpdates({
            requested: input.sendUpdates,
            hasOtherGuests: guests.length > 0,
          }),
        },
      });
      return toActionResult(result, target.summary);
    },
  );

export const updateCalendarEventAction = actionClient
  .metadata({ name: "updateCalendarEvent" })
  .inputSchema(updateCalendarEventBody)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { calendarId, providerEventId, sendUpdates, ...changes },
    }) => {
      const { target, row } = await loadEvent({
        emailAccountId,
        calendarId,
        providerEventId,
        logger,
      });
      const stored = parseAttendees(row.attendees);
      const guests = changes.guests
        ? composeGuests({ stored, incoming: changes.guests })
        : undefined;

      const result = await updateEventLocalFirst({
        writer: target.writer,
        calendar: target.ref,
        row,
        patch: {
          title: changes.title,
          description: changes.description,
          location: changes.location,
          timing: changes.timing && toEventTiming(changes.timing),
          guests,
          reminders: changes.reminders && toReminders(changes.reminders),
          addVideoConference: changes.addVideoConference,
        },
        sendUpdates: resolveSendUpdates({
          requested: sendUpdates,
          hasOtherGuests:
            hasOtherGuests(stored) || (changes.guests?.length ?? 0) > 0,
        }),
      });
      return toActionResult(result, target.summary);
    },
  );

export const moveCalendarEventAction = actionClient
  .metadata({ name: "moveCalendarEvent" })
  .inputSchema(moveCalendarEventBody)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { calendarId, providerEventId, newStart, sendUpdates },
    }) => {
      const { target, row } = await loadEvent({
        emailAccountId,
        calendarId,
        providerEventId,
        logger,
      });
      if (row.isAllDay !== /^\d{4}-\d{2}-\d{2}$/.test(newStart)) {
        throw new SafeError("Invalid date");
      }

      const result = await moveEventLocalFirst({
        writer: target.writer,
        calendar: target.ref,
        row,
        newStart: row.isAllDay ? newStart : new Date(newStart),
        sendUpdates: resolveSendUpdates({
          requested: sendUpdates,
          hasOtherGuests: hasOtherGuests(parseAttendees(row.attendees)),
        }),
      });
      return toActionResult(result, target.summary);
    },
  );

export const deleteCalendarEventAction = actionClient
  .metadata({ name: "deleteCalendarEvent" })
  .inputSchema(deleteCalendarEventBody)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { calendarId, providerEventId, sendUpdates },
    }) => {
      const { target, row } = await loadEvent({
        emailAccountId,
        calendarId,
        providerEventId,
        logger,
      });
      const result = await deleteEventLocalFirst({
        writer: target.writer,
        calendar: target.ref,
        row,
        sendUpdates: resolveSendUpdates({
          requested: sendUpdates,
          hasOtherGuests: hasOtherGuests(parseAttendees(row.attendees)),
        }),
      });
      if (!result.ok) throw new SafeError(result.failure.message);
      return { status: "deleted" as const };
    },
  );

export const respondToCalendarEventAction = actionClient
  .metadata({ name: "respondToCalendarEvent" })
  .inputSchema(respondToCalendarEventBody)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { calendarId, providerEventId, response, sendUpdates },
    }) => {
      const { target, row } = await loadEvent({
        emailAccountId,
        calendarId,
        providerEventId,
        logger,
      });
      const result = await respondToEventLocalFirst({
        writer: target.writer,
        calendar: target.ref,
        row,
        response,
        sendUpdates: sendUpdates ?? "all",
      });
      return toActionResult(result, target.summary);
    },
  );

export const setCalendarEventRemindersAction = actionClient
  .metadata({ name: "setCalendarEventReminders" })
  .inputSchema(setCalendarEventRemindersBody)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { calendarId, providerEventId, reminders },
    }) => {
      const { target, row } = await loadEvent({
        emailAccountId,
        calendarId,
        providerEventId,
        logger,
      });
      const result = await setRemindersLocalFirst({
        writer: target.writer,
        calendar: target.ref,
        row,
        reminders: toReminders(reminders),
      });
      return toActionResult(result, target.summary);
    },
  );

/**
 * A calendar of this account that can be written to. Ownership is checked
 * through the connection, and the write is refused for a connection that must
 * be reconnected, an Outlook calendar, or a read-only calendar.
 */
async function loadWritableCalendar({
  emailAccountId,
  calendarId,
  logger,
}: {
  emailAccountId: string;
  calendarId: string;
  logger: Logger;
}) {
  const calendar = await prisma.calendar.findFirst({
    where: { id: calendarId, connection: { emailAccountId } },
    select: {
      id: true,
      calendarId: true,
      name: true,
      color: true,
      timezone: true,
      canEdit: true,
      connection: {
        select: {
          id: true,
          email: true,
          provider: true,
          isConnected: true,
          scope: true,
          accessToken: true,
          refreshToken: true,
          expiresAt: true,
        },
      },
    },
  });
  if (!calendar) throw new SafeError("Calendar not found");

  const block = getWriteBlock({
    provider: calendar.connection.provider,
    state: getCalendarConnectionState(calendar.connection),
    canEdit: calendar.canEdit,
  });
  if (block) throw new SafeError(getWriteBlockMessage(block));

  return {
    ref: { id: calendar.id, providerCalendarId: calendar.calendarId },
    summary: { id: calendar.id, name: calendar.name, color: calendar.color },
    organizerEmail: calendar.connection.email,
    writer: getCalendarEventWriter({
      connection: calendar.connection,
      emailAccountId,
      calendarTimeZone: calendar.timezone,
      logger,
    }),
  };
}

async function loadEvent({
  emailAccountId,
  calendarId,
  providerEventId,
  logger,
}: {
  emailAccountId: string;
  calendarId: string;
  providerEventId: string;
  logger: Logger;
}) {
  const target = await loadWritableCalendar({
    emailAccountId,
    calendarId,
    logger,
  });
  const row = await prisma.calendarEvent.findUnique({
    where: {
      calendarId_providerEventId: { calendarId, providerEventId },
    },
  });
  if (!row) throw new SafeError("Event not found");
  return { target, row };
}

function toActionResult(
  result: LocalWriteResult,
  calendar: { id: string; name: string; color: string | null },
) {
  if (result.ok) {
    return {
      status: "saved" as const,
      event: toView(result.event, calendar),
    };
  }
  if (result.failure.reason === "conflict") {
    return {
      status: "conflict" as const,
      event: result.event ? toView(result.event, calendar) : null,
    };
  }
  throw new SafeError(result.failure.message);
}

function toView(
  row: CalendarEvent,
  calendar: { id: string; name: string; color: string | null },
) {
  return toViewEvent({ event: row, calendar, id: row.id });
}

function toEventTiming(
  timing: NonNullable<CreateCalendarEventBody["timing"]>,
): EventTiming {
  return timing.isAllDay
    ? timing
    : {
        isAllDay: false,
        start: new Date(timing.start),
        end: new Date(timing.end),
        timeZone: timing.timeZone,
      };
}

function toReminders(reminders: {
  useDefault: boolean;
  overrides: Array<{ method: "popup" | "email"; minutes: number }>;
}): EventReminders {
  return reminders.useDefault
    ? { useDefault: true }
    : { useDefault: false, overrides: reminders.overrides };
}

function dedupeGuests(guests: Array<{ email: string; name?: string }>) {
  const seen = new Set<string>();
  return guests.filter((guest) => {
    const key = guest.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
