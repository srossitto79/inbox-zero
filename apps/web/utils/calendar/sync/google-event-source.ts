import type { calendar_v3 } from "@googleapis/calendar";
import { buildAttendee } from "@/utils/calendar/sync/attendees";
import { findVideoConferenceLink } from "@/utils/calendar/video-conference-link";
import {
  type EventRowData,
  type EventSyncPage,
  type EventSyncRequest,
  type EventSyncSource,
  type SyncItem,
  SyncCursorExpiredError,
} from "@/utils/calendar/sync/types";
import { isValidTimeZone } from "@/utils/calendar/zoned-time";
import { extractErrorInfo } from "@/utils/gmail/retry";

const PAGE_SIZE = 250;

export function createGoogleEventSource(
  client: calendar_v3.Calendar,
): EventSyncSource {
  return {
    async fetchPage(request) {
      let data: calendar_v3.Schema$Events;
      try {
        const response = await client.events.list({
          calendarId: request.calendarId,
          maxResults: PAGE_SIZE,
          // Masters and their exceptions, not expanded instances. See the
          // note in recurrence.ts. Deleted instances must be included so a
          // cancelled occurrence can hide its slot.
          singleEvents: false,
          showDeleted: true,
          pageToken: request.pageToken ?? undefined,
          // Google rejects timeMin/timeMax together with a syncToken; the
          // token remembers the window it was issued for.
          ...(request.cursor
            ? { syncToken: request.cursor }
            : {
                timeMin: request.window.from.toISOString(),
                timeMax: request.window.to.toISOString(),
              }),
        });
        data = response.data;
      } catch (error) {
        if (extractErrorInfo(error).status === 410) {
          throw new SyncCursorExpiredError();
        }
        throw error;
      }

      return toSyncPage(data, request);
    },
  };
}

function toSyncPage(
  data: calendar_v3.Schema$Events,
  request: EventSyncRequest,
): EventSyncPage {
  return {
    items: (data.items ?? []).flatMap((event) => {
      const item = mapGoogleEvent(event, request.calendarTimeZone);
      return item ? [item] : [];
    }),
    nextPageToken: data.nextPageToken ?? null,
    nextCursor: data.nextPageToken ? null : (data.nextSyncToken ?? null),
  };
}

export function mapGoogleEvent(
  event: calendar_v3.Schema$Event,
  calendarTimeZone: string | null,
): SyncItem | null {
  const providerEventId = event.id;
  if (!providerEventId) return null;

  const isInstance = Boolean(event.recurringEventId);
  const originalStart = parseGoogleTime(event.originalStartTime);

  if (event.status === "cancelled") {
    // A cancelled instance stays as a tombstone so the series does not
    // regenerate it. Anything else cancelled is simply gone.
    if (isInstance && originalStart) {
      return {
        kind: "upsert",
        data: {
          ...emptyRow(providerEventId),
          status: "CANCELLED",
          startTime: originalStart.instant,
          endTime: originalStart.instant,
          isAllDay: originalStart.isAllDay,
          recurringEventId: event.recurringEventId,
          originalStartTime: originalStart.instant,
        },
      };
    }
    return { kind: "remove", providerEventId, withInstances: !isInstance };
  }

  const start = parseGoogleTime(event.start);
  const end = parseGoogleTime(event.end) ?? start;
  if (!start || !end) return null;

  const attendees = (event.attendees ?? []).flatMap((attendee) =>
    attendee.email
      ? [
          buildAttendee({
            email: attendee.email,
            name: attendee.displayName,
            responseStatus: attendee.responseStatus,
            isSelf: attendee.self,
            isOrganizer: attendee.organizer,
          }),
        ]
      : [],
  );
  const self = event.attendees?.find((attendee) => attendee.self);
  const timeZone = event.start?.timeZone ?? calendarTimeZone;

  const data: EventRowData = {
    providerEventId,
    iCalUid: event.iCalUID ?? null,
    etag: event.etag ?? null,
    providerUpdatedAt: event.updated ? new Date(event.updated) : null,
    title: event.summary?.trim() || "Untitled",
    description: event.description ?? null,
    location: event.location ?? null,
    startTime: start.instant,
    endTime: end.instant,
    isAllDay: start.isAllDay,
    timezone: isValidTimeZone(timeZone) ? timeZone : null,
    status: event.status === "tentative" ? "TENTATIVE" : "CONFIRMED",
    isBusy: event.transparency !== "transparent",
    organizerEmail: event.organizer?.email ?? null,
    organizerName: event.organizer?.displayName ?? null,
    isOrganizer: event.organizer?.self ?? false,
    selfResponseStatus: self?.responseStatus ?? null,
    attendees,
    recurringEventId: event.recurringEventId ?? null,
    recurrence: event.recurrence ?? [],
    originalStartTime: originalStart?.instant ?? null,
    videoLink: getGoogleVideoLink(event) ?? null,
    htmlLink: event.htmlLink ?? null,
    reminders: {
      useDefault: event.reminders?.useDefault ?? true,
      overrides: (event.reminders?.overrides ?? []).flatMap((override) =>
        override.method && typeof override.minutes === "number"
          ? [{ method: override.method, minutes: override.minutes }]
          : [],
      ),
    },
  };
  return { kind: "upsert", data };
}

function emptyRow(providerEventId: string): EventRowData {
  const epoch = new Date(0);
  return {
    providerEventId,
    title: "",
    startTime: epoch,
    endTime: epoch,
    recurrence: [],
  };
}

/** All-day dates become UTC midnight; see the CalendarEvent model note. */
function parseGoogleTime(time: calendar_v3.Schema$EventDateTime | undefined) {
  if (time?.dateTime) {
    return { instant: new Date(time.dateTime), isAllDay: false };
  }
  if (time?.date) {
    const [year, month, day] = time.date.split("-").map(Number);
    return {
      instant: new Date(Date.UTC(year, month - 1, day)),
      isAllDay: true,
    };
  }
  return null;
}

function getGoogleVideoLink(event: calendar_v3.Schema$Event) {
  return (
    event.conferenceData?.entryPoints?.find(
      (entry) => entry.entryPointType === "video",
    )?.uri ??
    event.hangoutLink ??
    findVideoConferenceLink(event.location, event.description)
  );
}
