import { Prisma } from "@/generated/prisma/client";
import type { CalendarEvent } from "@/generated/prisma/client";
import { buildAttendee } from "@/utils/calendar/sync/attendees";
import type { EventRowData } from "@/utils/calendar/sync/types";
import { shiftTiming } from "@/utils/calendar/write/timing";
import type {
  CalendarEventWriter,
  CreateEventInput,
  EventGuest,
  EventReminders,
  EventTiming,
  ResponseStatus,
  RsvpResponse,
  SendUpdates,
  UpdateEventInput,
  WriteFailure,
} from "@/utils/calendar/write/types";
import { formatDateKey } from "@/utils/calendar/zoned-time";
import prisma from "@/utils/prisma";

export type LocalWriteResult =
  | { ok: true; event: CalendarEvent }
  | {
      ok: false;
      failure: WriteFailure;
      /** The provider's current copy, present after a conflict. */
      event?: CalendarEvent;
    };

type CalendarRef = {
  /** Database id (Calendar.id). */
  id: string;
  /** Provider calendar id (Calendar.calendarId). */
  providerCalendarId: string;
};

type EventPatch = UpdateEventInput["patch"];

const READ_ONLY_RECURRING: WriteFailure = {
  ok: false,
  reason: "unsupported",
  message: "Recurring events are read-only",
};

export function isRecurringRow(
  row: Pick<CalendarEvent, "recurrence" | "recurringEventId">,
) {
  return row.recurrence.length > 0 || row.recurringEventId !== null;
}

export async function createEventLocalFirst({
  writer,
  calendar,
  organizerEmail,
  providerEventId,
  input,
}: {
  writer: CalendarEventWriter;
  calendar: CalendarRef;
  organizerEmail: string;
  providerEventId: string;
  input: Omit<CreateEventInput, "providerCalendarId" | "providerEventId">;
}): Promise<LocalWriteResult> {
  const optimistic: EventRowData = {
    providerEventId,
    title: input.title.trim() || "Untitled",
    description: input.description || null,
    location: input.location || null,
    ...timingToColumns(input.timing),
    isOrganizer: true,
    organizerEmail,
    selfResponseStatus: input.guests.length > 0 ? "accepted" : null,
    attendees:
      input.guests.length > 0
        ? [
            buildAttendee({
              email: organizerEmail,
              responseStatus: "accepted",
              isSelf: true,
              isOrganizer: true,
            }),
            ...input.guests.map((guest) =>
              buildAttendee({
                email: guest.email,
                name: guest.name,
                responseStatus: guest.responseStatus ?? "needsAction",
              }),
            ),
          ]
        : [],
    recurrence: [],
    reminders: input.reminders ? remindersToJson(input.reminders) : undefined,
  };
  await saveRow(calendar.id, optimistic);

  const result = await writer.createEvent({
    ...input,
    providerCalendarId: calendar.providerCalendarId,
    providerEventId,
  });
  if (!result.ok) {
    await prisma.calendarEvent.deleteMany({
      where: { calendarId: calendar.id, providerEventId },
    });
    return { ok: false, failure: result };
  }

  return { ok: true, event: await saveRow(calendar.id, result.value) };
}

export async function updateEventLocalFirst({
  writer,
  calendar,
  row,
  patch,
  sendUpdates,
}: {
  writer: CalendarEventWriter;
  calendar: CalendarRef;
  row: CalendarEvent;
  patch: EventPatch;
  sendUpdates: SendUpdates;
}): Promise<LocalWriteResult> {
  if (isRecurringRow(row)) return { ok: false, failure: READ_ONLY_RECURRING };

  return guardedWrite({
    calendar,
    row,
    optimistic: applyPatch(row, patch),
    write: () =>
      writer.updateEvent({
        providerCalendarId: calendar.providerCalendarId,
        providerEventId: row.providerEventId,
        etag: row.etag,
        patch,
        sendUpdates,
      }),
    writer,
  });
}

export async function moveEventLocalFirst({
  writer,
  calendar,
  row,
  newStart,
  sendUpdates,
}: {
  writer: CalendarEventWriter;
  calendar: CalendarRef;
  row: CalendarEvent;
  newStart: Date | string;
  sendUpdates: SendUpdates;
}): Promise<LocalWriteResult> {
  if (isRecurringRow(row)) return { ok: false, failure: READ_ONLY_RECURRING };

  const current = timingFromRow(row);
  return guardedWrite({
    calendar,
    row,
    optimistic: timingToColumns(shiftTiming(current, newStart)),
    write: () =>
      writer.moveEvent({
        providerCalendarId: calendar.providerCalendarId,
        providerEventId: row.providerEventId,
        etag: row.etag,
        current,
        newStart,
        sendUpdates,
      }),
    writer,
  });
}

export async function setRemindersLocalFirst({
  writer,
  calendar,
  row,
  reminders,
}: {
  writer: CalendarEventWriter;
  calendar: CalendarRef;
  row: CalendarEvent;
  reminders: EventReminders;
}): Promise<LocalWriteResult> {
  if (isRecurringRow(row)) return { ok: false, failure: READ_ONLY_RECURRING };

  return guardedWrite({
    calendar,
    row,
    optimistic: { reminders: remindersToJson(reminders) },
    write: () =>
      writer.setReminders({
        providerCalendarId: calendar.providerCalendarId,
        providerEventId: row.providerEventId,
        etag: row.etag,
        reminders,
      }),
    writer,
  });
}

export async function respondToEventLocalFirst({
  writer,
  calendar,
  row,
  response,
  sendUpdates,
}: {
  writer: CalendarEventWriter;
  calendar: CalendarRef;
  row: CalendarEvent;
  response: RsvpResponse;
  sendUpdates: SendUpdates;
}): Promise<LocalWriteResult> {
  if (isRecurringRow(row)) return { ok: false, failure: READ_ONLY_RECURRING };

  const attendees = toAttendeeList(row.attendees);
  const self = attendees.find((attendee) => attendee.isSelf);
  if (!self) {
    return {
      ok: false,
      failure: {
        ok: false,
        reason: "invalid",
        message: "You are not a guest of this event",
      },
    };
  }

  const withResponse = (list: typeof attendees) =>
    list.map((attendee) =>
      attendee.isSelf ? { ...attendee, responseStatus: response } : attendee,
    );

  await updateRow(calendar.id, row.providerEventId, {
    selfResponseStatus: response,
    attendees: withResponse(attendees),
  });

  const result = await writer.respondToEvent({
    providerCalendarId: calendar.providerCalendarId,
    providerEventId: row.providerEventId,
    selfEmail: self.email,
    response,
    sendUpdates,
  });
  if (!result.ok) {
    await restoreRow(calendar.id, row);
    return { ok: false, failure: result };
  }

  // The provider may omit other guests from an RSVP answer, so only its
  // bookkeeping fields replace the stored ones.
  const current = await findRow(calendar.id, row.providerEventId);
  const merged = await updateRow(calendar.id, row.providerEventId, {
    etag: result.value.etag,
    providerUpdatedAt: result.value.providerUpdatedAt,
    selfResponseStatus: response,
    attendees: withResponse(
      toAttendeeList(current?.attendees ?? row.attendees),
    ),
  });
  return {
    ok: true,
    event: merged ?? (await saveRow(calendar.id, result.value)),
  };
}

export async function deleteEventLocalFirst({
  writer,
  calendar,
  row,
  sendUpdates,
}: {
  writer: CalendarEventWriter;
  calendar: CalendarRef;
  row: CalendarEvent;
  sendUpdates: SendUpdates;
}): Promise<{ ok: true } | { ok: false; failure: WriteFailure }> {
  if (isRecurringRow(row)) return { ok: false, failure: READ_ONLY_RECURRING };

  await prisma.calendarEvent.deleteMany({
    where: { calendarId: calendar.id, providerEventId: row.providerEventId },
  });

  const result = await writer.deleteEvent({
    providerCalendarId: calendar.providerCalendarId,
    providerEventId: row.providerEventId,
    sendUpdates,
  });
  if (!result.ok) {
    await restoreRow(calendar.id, row);
    return { ok: false, failure: result };
  }
  return { ok: true };
}

/**
 * Applies `optimistic` to the stored row, runs the provider write, then either
 * replaces the row with the provider's answer or undoes the change. A
 * conflict replaces the row with the provider's current copy instead.
 */
async function guardedWrite({
  calendar,
  row,
  optimistic,
  write,
  writer,
}: {
  calendar: CalendarRef;
  row: CalendarEvent;
  optimistic: Partial<EventRowData>;
  write: () => ReturnType<CalendarEventWriter["updateEvent"]>;
  writer: CalendarEventWriter;
}): Promise<LocalWriteResult> {
  await updateRow(calendar.id, row.providerEventId, optimistic);

  const result = await write();
  if (result.ok) {
    return { ok: true, event: await saveRow(calendar.id, result.value) };
  }

  if (result.reason === "conflict") {
    const fresh = await writer.fetchEvent({
      providerCalendarId: calendar.providerCalendarId,
      providerEventId: row.providerEventId,
    });
    if (fresh.ok) {
      return {
        ok: false,
        failure: result,
        event: await saveRow(calendar.id, fresh.value),
      };
    }
    if (fresh.reason === "not_found") {
      await prisma.calendarEvent.deleteMany({
        where: {
          calendarId: calendar.id,
          providerEventId: row.providerEventId,
        },
      });
      return { ok: false, failure: fresh };
    }
  }

  if (result.reason === "not_found") {
    await prisma.calendarEvent.deleteMany({
      where: { calendarId: calendar.id, providerEventId: row.providerEventId },
    });
    return { ok: false, failure: result };
  }

  await restoreRow(calendar.id, row);
  return { ok: false, failure: result };
}

export function timingFromRow(
  row: Pick<CalendarEvent, "isAllDay" | "startTime" | "endTime" | "timezone">,
): EventTiming {
  if (row.isAllDay) {
    return {
      isAllDay: true,
      startDate: toUtcDateKey(row.startTime),
      endDate: toUtcDateKey(row.endTime),
    };
  }
  return {
    isAllDay: false,
    start: row.startTime,
    end: row.endTime,
    timeZone: row.timezone ?? "UTC",
  };
}

/** Column values for a timing; all-day dates are stored as UTC midnight. */
export function timingToColumns(timing: EventTiming) {
  if (timing.isAllDay) {
    return {
      isAllDay: true,
      startTime: new Date(`${timing.startDate}T00:00:00.000Z`),
      endTime: new Date(`${timing.endDate}T00:00:00.000Z`),
      timezone: null,
    };
  }
  return {
    isAllDay: false,
    startTime: timing.start,
    endTime: timing.end,
    timezone: timing.timeZone,
  };
}

function applyPatch(row: CalendarEvent, patch: EventPatch) {
  const changes: Partial<EventRowData> = {};
  if (patch.title !== undefined) {
    changes.title = patch.title.trim() || "Untitled";
  }
  if (patch.description !== undefined) {
    changes.description = patch.description || null;
  }
  if (patch.location !== undefined) changes.location = patch.location || null;
  if (patch.timing) Object.assign(changes, timingToColumns(patch.timing));
  if (patch.guests)
    changes.attendees = mergeGuests(row.attendees, patch.guests);
  if (patch.reminders) changes.reminders = remindersToJson(patch.reminders);
  return changes;
}

/** Guests already on the event keep their response and flags. */
function mergeGuests(stored: unknown, guests: EventGuest[]) {
  const existing = new Map(
    toAttendeeList(stored).map((attendee) => [
      attendee.email.toLowerCase(),
      attendee,
    ]),
  );
  return guests.map((guest) => {
    const known = existing.get(guest.email.toLowerCase());
    return known
      ? buildAttendee(known)
      : buildAttendee({
          email: guest.email,
          name: guest.name,
          responseStatus: guest.responseStatus ?? "needsAction",
        });
  });
}

function remindersToJson(reminders: EventReminders) {
  return reminders.useDefault
    ? { useDefault: true, overrides: [] }
    : { useDefault: false, overrides: reminders.overrides };
}

type StoredAttendeeLike = ReturnType<typeof buildAttendee>;

function toAttendeeList(value: unknown): StoredAttendeeLike[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.email !== "string" || !record.email) return [];
    return [
      buildAttendee({
        email: record.email,
        name: typeof record.name === "string" ? record.name : undefined,
        responseStatus:
          typeof record.responseStatus === "string"
            ? (record.responseStatus as ResponseStatus)
            : undefined,
        isSelf: record.isSelf === true,
        isOrganizer: record.isOrganizer === true,
      }),
    ];
  });
}

async function findRow(calendarId: string, providerEventId: string) {
  return prisma.calendarEvent.findUnique({
    where: { calendarId_providerEventId: { calendarId, providerEventId } },
  });
}

/** Rows are addressed by provider id: the sync replaces rows, so ids move. */
async function updateRow(
  calendarId: string,
  providerEventId: string,
  data: Partial<EventRowData>,
) {
  const { count } = await prisma.calendarEvent.updateMany({
    where: { calendarId, providerEventId },
    data: toWriteData(data),
  });
  return count > 0 ? findRow(calendarId, providerEventId) : null;
}

/** Writes the row whether or not the sync replaced it in the meantime. */
async function saveRow(calendarId: string, data: EventRowData) {
  const updated = await updateRow(calendarId, data.providerEventId, data);
  if (updated) return updated;
  return prisma.calendarEvent.create({
    data: {
      ...toWriteData(data),
      calendarId,
    } as Prisma.CalendarEventUncheckedCreateInput,
  });
}

async function restoreRow(calendarId: string, snapshot: CalendarEvent) {
  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    calendarId: _calendarId,
    ...data
  } = snapshot;
  await saveRow(calendarId, data as EventRowData);
}

/** Prisma JSON columns take JsonNull instead of null. */
function toWriteData(data: Partial<EventRowData>) {
  const { attendees, reminders, ...rest } = data as Record<string, unknown>;
  return {
    ...rest,
    ...(attendees === undefined
      ? {}
      : { attendees: attendees ?? Prisma.JsonNull }),
    ...(reminders === undefined
      ? {}
      : { reminders: reminders ?? Prisma.JsonNull }),
  } as Prisma.CalendarEventUncheckedUpdateManyInput;
}

function toUtcDateKey(date: Date) {
  return formatDateKey(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}
