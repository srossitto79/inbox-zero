import { randomUUID } from "node:crypto";
import type { calendar_v3 } from "@googleapis/calendar";
import { mapGoogleEvent } from "@/utils/calendar/sync/google-event-source";
import type { EventRowData } from "@/utils/calendar/sync/types";
import { runWriteCall } from "@/utils/calendar/write/run-write-call";
import { getTimingProblem, shiftTiming } from "@/utils/calendar/write/timing";
import type {
  CalendarEventWriter,
  EventGuest,
  EventReminders,
  EventTiming,
  WriteFailure,
  WriteResult,
} from "@/utils/calendar/write/types";
import type { Logger } from "@/utils/logger";

type GoogleCalendarClient = Pick<calendar_v3.Calendar, "events">;

/**
 * Google implementation of the write layer. `getClient` is called inside the
 * budgeted call, so a token refresh only happens when a write is attempted.
 */
export function createGoogleEventWriter({
  getClient,
  emailAccountId,
  calendarTimeZone = null,
  logger,
}: {
  getClient: () => Promise<GoogleCalendarClient>;
  emailAccountId: string;
  /** Zone assumed for events that do not carry their own. */
  calendarTimeZone?: string | null;
  logger: Logger;
}): CalendarEventWriter {
  const run = <T>(operation: (client: GoogleCalendarClient) => Promise<T>) =>
    runWriteCall({
      emailAccountId,
      provider: "google",
      logger,
      operation: async () => operation(await getClient()),
    });

  const toRow = (
    event: calendar_v3.Schema$Event,
  ): WriteResult<EventRowData> => {
    const item = mapGoogleEvent(event, calendarTimeZone);
    if (item?.kind !== "upsert") return failed("Could not save the event");
    return { ok: true, value: item.data };
  };

  const patch = async ({
    providerCalendarId,
    providerEventId,
    etag,
    requestBody,
    sendUpdates,
    conferenceDataVersion,
  }: {
    providerCalendarId: string;
    providerEventId: string;
    etag?: string | null;
    requestBody: calendar_v3.Schema$Event;
    sendUpdates: string;
    conferenceDataVersion?: number;
  }) => {
    const result = await run((client) =>
      client.events.patch(
        {
          calendarId: providerCalendarId,
          eventId: providerEventId,
          sendUpdates,
          conferenceDataVersion,
          requestBody,
        },
        etag ? { headers: { "If-Match": etag } } : undefined,
      ),
    );
    return result.ok ? toRow(result.value.data) : result;
  };

  return {
    async createEvent(input) {
      const problem = getTimingProblem(input.timing);
      if (problem) return invalid(problem);

      const result = await run((client) =>
        client.events.insert({
          calendarId: input.providerCalendarId,
          conferenceDataVersion: input.addVideoConference ? 1 : undefined,
          sendUpdates: input.sendUpdates,
          requestBody: {
            id: input.providerEventId,
            summary: input.title,
            description: input.description || undefined,
            location: input.location || undefined,
            ...toGoogleTiming(input.timing, false),
            attendees: input.guests.length
              ? input.guests.map(toGoogleAttendee)
              : undefined,
            reminders: input.reminders
              ? toGoogleReminders(input.reminders)
              : undefined,
            conferenceData: input.addVideoConference
              ? buildConferenceRequest()
              : undefined,
          },
        }),
      );
      return result.ok ? toRow(result.value.data) : result;
    },

    async updateEvent(input) {
      const changes = input.patch;
      if (changes.timing) {
        const problem = getTimingProblem(changes.timing);
        if (problem) return invalid(problem);
      }
      return patch({
        ...input,
        conferenceDataVersion: changes.addVideoConference ? 1 : undefined,
        requestBody: {
          summary: changes.title,
          // null deletes the field; an empty string would keep an empty one.
          description:
            changes.description === undefined
              ? undefined
              : changes.description || null,
          location:
            changes.location === undefined
              ? undefined
              : changes.location || null,
          ...(changes.timing ? toGoogleTiming(changes.timing, true) : {}),
          attendees: changes.guests?.map(toGoogleAttendee),
          reminders: changes.reminders
            ? toGoogleReminders(changes.reminders)
            : undefined,
          conferenceData: changes.addVideoConference
            ? buildConferenceRequest()
            : undefined,
        },
      });
    },

    async moveEvent(input) {
      const timing = shiftTiming(input.current, input.newStart);
      return patch({
        ...input,
        requestBody: toGoogleTiming(timing, true),
      });
    },

    async deleteEvent(input) {
      const result = await run((client) =>
        client.events.delete({
          calendarId: input.providerCalendarId,
          eventId: input.providerEventId,
          sendUpdates: input.sendUpdates,
        }),
      );
      if (result.ok) return { ok: true, value: null };
      // Gone upstream already, which is what the caller wanted.
      if (result.reason === "not_found") return { ok: true, value: null };
      return result;
    },

    // Patching only the viewer's attendee entry leaves the guest list alone.
    async respondToEvent(input) {
      return patch({
        ...input,
        etag: null,
        requestBody: {
          attendeesOmitted: true,
          attendees: [
            { email: input.selfEmail, responseStatus: input.response },
          ],
        },
      });
    },

    async setReminders(input) {
      return patch({
        ...input,
        sendUpdates: "none",
        requestBody: { reminders: toGoogleReminders(input.reminders) },
      });
    },

    async fetchEvent(input) {
      const result = await run((client) =>
        client.events.get({
          calendarId: input.providerCalendarId,
          eventId: input.providerEventId,
        }),
      );
      return result.ok ? toRow(result.value.data) : result;
    },
  };
}

/** A fresh id: Google accepts 5-1024 characters from a-v and 0-9. */
export function newGoogleEventId() {
  return randomUUID().replaceAll("-", "");
}

function toGoogleTiming(timing: EventTiming, forPatch: boolean) {
  if (timing.isAllDay) {
    const nulls = forPatch ? { dateTime: null, timeZone: null } : {};
    return {
      start: { date: timing.startDate, ...nulls },
      end: { date: timing.endDate, ...nulls },
    };
  }
  const nulls = forPatch ? { date: null } : {};
  return {
    start: {
      dateTime: timing.start.toISOString(),
      timeZone: timing.timeZone,
      ...nulls,
    },
    end: {
      dateTime: timing.end.toISOString(),
      timeZone: timing.timeZone,
      ...nulls,
    },
  };
}

function toGoogleAttendee(guest: EventGuest): calendar_v3.Schema$EventAttendee {
  return {
    email: guest.email,
    displayName: guest.name,
    responseStatus: guest.responseStatus,
  };
}

function toGoogleReminders(
  reminders: EventReminders,
): calendar_v3.Schema$Event["reminders"] {
  return reminders.useDefault
    ? { useDefault: true }
    : { useDefault: false, overrides: reminders.overrides };
}

function buildConferenceRequest(): calendar_v3.Schema$ConferenceData {
  return {
    createRequest: {
      requestId: randomUUID(),
      conferenceSolutionKey: { type: "hangoutsMeet" },
    },
  };
}

function invalid(message: string): WriteFailure {
  return { ok: false, reason: "invalid", message };
}

function failed(message: string): WriteFailure {
  return { ok: false, reason: "failed", message };
}
