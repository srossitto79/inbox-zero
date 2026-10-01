import type { Client } from "@microsoft/microsoft-graph-client";
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

const PAGE_SIZE = 100;
const SELECT_FIELDS = [
  "id",
  "iCalUId",
  "subject",
  "bodyPreview",
  "body",
  "start",
  "end",
  "isAllDay",
  "isCancelled",
  "isOrganizer",
  "showAs",
  "type",
  "seriesMasterId",
  "originalStart",
  "originalStartTimeZone",
  "organizer",
  "attendees",
  "responseStatus",
  "location",
  "onlineMeeting",
  "onlineMeetingUrl",
  "webLink",
  "lastModifiedDateTime",
].join(",");

// UTC keeps every instant unambiguous; the original zone is read separately.
const PREFER_HEADER = `odata.maxpagesize=${PAGE_SIZE}, outlook.timezone="UTC", outlook.body-content-type="text"`;

export type MicrosoftGraphEvent = {
  id?: string;
  "@removed"?: { reason?: string };
  "@odata.etag"?: string;
  iCalUId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string };
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  isOrganizer?: boolean;
  showAs?: string;
  type?: string;
  seriesMasterId?: string;
  originalStart?: string;
  originalStartTimeZone?: string;
  organizer?: { emailAddress?: { address?: string; name?: string } };
  attendees?: Array<{
    emailAddress?: { address?: string; name?: string };
    status?: { response?: string };
  }>;
  responseStatus?: { response?: string };
  location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingUrl?: string | null;
  webLink?: string;
  lastModifiedDateTime?: string;
};

/**
 * calendarView/delta returns occurrences, exceptions and single events, never
 * series masters, so recurring events arrive already expanded and are stored
 * as plain rows that point at their series.
 */
export function createMicrosoftEventSource(client: Client): EventSyncSource {
  return {
    async fetchPage(request) {
      const nextUrl = request.pageToken ?? request.cursor;
      let response: {
        value?: MicrosoftGraphEvent[];
        "@odata.nextLink"?: string;
        "@odata.deltaLink"?: string;
      };
      try {
        const query = nextUrl
          ? client.api(nextUrl)
          : client
              .api(
                `/me/calendars/${encodeURIComponent(request.calendarId)}/calendarView/delta`,
              )
              .query({
                startDateTime: request.window.from.toISOString(),
                endDateTime: request.window.to.toISOString(),
              })
              .select(SELECT_FIELDS);
        response = await query.header("Prefer", PREFER_HEADER).get();
      } catch (error) {
        if (isSyncStateGone(error)) throw new SyncCursorExpiredError();
        throw error;
      }

      return toSyncPage(response, request);
    },
  };
}

function toSyncPage(
  response: {
    value?: MicrosoftGraphEvent[];
    "@odata.nextLink"?: string;
    "@odata.deltaLink"?: string;
  },
  request: EventSyncRequest,
): EventSyncPage {
  const nextPageToken = response["@odata.nextLink"] ?? null;
  return {
    items: (response.value ?? []).flatMap((event) => {
      const item = mapMicrosoftEvent(event, request.calendarTimeZone);
      return item ? [item] : [];
    }),
    nextPageToken,
    nextCursor: nextPageToken ? null : (response["@odata.deltaLink"] ?? null),
  };
}

export function mapMicrosoftEvent(
  event: MicrosoftGraphEvent,
  calendarTimeZone: string | null,
): SyncItem | null {
  const providerEventId = event.id;
  if (!providerEventId) return null;

  // "changed" means the event moved out of the sync window; either way the
  // stored copy should go, and it returns if it is still in range.
  if (event["@removed"] || event.isCancelled) {
    return { kind: "remove", providerEventId, withInstances: false };
  }
  // Defensive: delta does not return masters, and a master has no slot of
  // its own to draw.
  if (event.type === "seriesMaster") return null;

  const isAllDay = event.isAllDay === true;
  const start = parseGraphTime(event.start?.dateTime, isAllDay);
  const end = parseGraphTime(event.end?.dateTime, isAllDay) ?? start;
  if (!start || !end) return null;

  const response = event.responseStatus?.response;
  const zone = isValidTimeZone(event.originalStartTimeZone)
    ? (event.originalStartTimeZone as string)
    : calendarTimeZone;
  const isInstance =
    Boolean(event.seriesMasterId) &&
    (event.type === "occurrence" || event.type === "exception");
  const originalStart = event.originalStart
    ? parseGraphTime(event.originalStart, false)
    : null;
  const location = event.location?.displayName || null;
  const description = event.body?.content?.trim() || event.bodyPreview || null;

  const data: EventRowData = {
    providerEventId,
    iCalUid: event.iCalUId ?? null,
    etag: event["@odata.etag"] ?? null,
    providerUpdatedAt: event.lastModifiedDateTime
      ? new Date(event.lastModifiedDateTime)
      : null,
    title: event.subject?.trim() || "Untitled",
    description,
    location,
    startTime: start,
    endTime: end,
    isAllDay,
    timezone: isValidTimeZone(zone) ? zone : null,
    status:
      response === "tentativelyAccepted" || event.showAs === "tentative"
        ? "TENTATIVE"
        : "CONFIRMED",
    isBusy: event.showAs !== "free",
    organizerEmail: event.organizer?.emailAddress?.address ?? null,
    organizerName: event.organizer?.emailAddress?.name ?? null,
    isOrganizer: event.isOrganizer ?? false,
    selfResponseStatus: mapResponse(response),
    attendees: (event.attendees ?? []).flatMap((attendee) =>
      attendee.emailAddress?.address
        ? [
            buildAttendee({
              email: attendee.emailAddress.address,
              name: attendee.emailAddress.name,
              responseStatus: mapResponse(attendee.status?.response),
            }),
          ]
        : [],
    ),
    recurringEventId: isInstance ? (event.seriesMasterId ?? null) : null,
    recurrence: [],
    originalStartTime: isInstance ? originalStart : null,
    videoLink:
      event.onlineMeeting?.joinUrl ??
      event.onlineMeetingUrl ??
      findVideoConferenceLink(location, description) ??
      null,
    htmlLink: event.webLink ?? null,
  };
  return { kind: "upsert", data };
}

/** Graph "UTC" values carry no offset; all-day values keep only their date. */
function parseGraphTime(value: string | undefined, isAllDay: boolean) {
  if (!value) return null;
  if (isAllDay) {
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  const instant = new Date(
    /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`,
  );
  return Number.isNaN(instant.getTime()) ? null : instant;
}

// Normalised to Google's vocabulary, which the views use.
function mapResponse(response: string | undefined) {
  switch (response) {
    case "accepted":
    case "organizer":
      return "accepted";
    case "declined":
      return "declined";
    case "tentativelyAccepted":
      return "tentative";
    case "notResponded":
    case "none":
      return "needsAction";
    default:
      return null;
  }
}

function isSyncStateGone(error: unknown) {
  const { statusCode, code } = (error ?? {}) as {
    statusCode?: number;
    code?: string;
  };
  return (
    statusCode === 410 ||
    code === "syncStateNotFound" ||
    code === "resyncRequired"
  );
}
