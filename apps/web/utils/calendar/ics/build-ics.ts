import { buildVTimezone } from "@/utils/calendar/ics/vtimezone";
import { isValidTimeZone } from "@/utils/calendar/zoned-time";

export type IcsExportEvent = {
  /** Shared by a series master and its exceptions. */
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  /** All-day events carry UTC midnight instants; `end` is exclusive. */
  start: Date;
  end: Date;
  isAllDay: boolean;
  /** IANA zone the event was authored in. */
  timezone?: string | null;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  isBusy?: boolean;
  /** RRULE, EXDATE and RDATE lines; present on a series master only. */
  recurrence?: string[];
  /** Slot an exception replaces; marks the event as a series exception. */
  originalStartTime?: Date | null;
  organizer?: { email: string; name?: string | null } | null;
  attendees?: {
    email: string;
    name?: string | null;
    responseStatus?: string | null;
  }[];
  /** Minutes before the start. */
  reminders?: number[];
  url?: string | null;
  updatedAt?: Date | null;
};

const PARTSTAT: Record<string, string> = {
  accepted: "ACCEPTED",
  declined: "DECLINED",
  tentative: "TENTATIVE",
  needsAction: "NEEDS-ACTION",
};

const PRODID = "-//Inbox Zero//Calendar//EN";

/** A complete RFC 5545 calendar for the events. */
export function buildIcs({
  events,
  calendarName,
  now = new Date(),
}: {
  events: IcsExportEvent[];
  calendarName?: string;
  now?: Date;
}): string {
  return [
    ...buildIcsHeader(calendarName),
    ...buildIcsTimezones(events),
    ...events.flatMap((event) => buildIcsEvent(event, now)),
    ...buildIcsFooter(),
  ]
    .join("\r\n")
    .concat("\r\n");
}

export function buildIcsHeader(calendarName?: string) {
  return foldLines([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...(calendarName ? [`X-WR-CALNAME:${escapeText(calendarName)}`] : []),
  ]);
}

export function buildIcsFooter() {
  return ["END:VCALENDAR"];
}

/** VTIMEZONE blocks for every zone a recurring event refers to. */
export function buildIcsTimezones(events: IcsExportEvent[]) {
  const zones = new Map<string, number>();
  for (const event of events) {
    if (!event.recurrence?.length) continue;
    for (const zone of getRecurringZones(event)) {
      if (!zones.has(zone)) zones.set(zone, event.start.getUTCFullYear());
    }
  }
  return [...zones].flatMap(([zone, year]) => buildVTimezone(zone, year));
}

export function buildIcsEvent(event: IcsExportEvent, now: Date): string[] {
  const zone = getEventZone(event);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${formatUtc(event.updatedAt ?? now)}`,
  ];

  if (event.originalStartTime) {
    lines.push(
      formatDateProperty("RECURRENCE-ID", event.originalStartTime, {
        isAllDay: event.isAllDay,
        zone,
      }),
    );
  }

  const end = event.isAllDay ? getAllDayEnd(event) : event.end;
  lines.push(
    formatDateProperty("DTSTART", event.start, {
      isAllDay: event.isAllDay,
      zone,
    }),
    formatDateProperty("DTEND", end, { isAllDay: event.isAllDay, zone }),
  );

  for (const line of event.recurrence ?? []) lines.push(line);

  lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  }
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.url) lines.push(`URL:${escapeText(event.url)}`);
  lines.push(
    `STATUS:${event.status ?? "CONFIRMED"}`,
    `TRANSP:${event.isBusy === false ? "TRANSPARENT" : "OPAQUE"}`,
  );

  if (event.organizer) {
    lines.push(formatPerson("ORGANIZER", event.organizer));
  }
  for (const attendee of event.attendees ?? []) {
    lines.push(
      formatPerson("ATTENDEE", attendee, {
        partstat: PARTSTAT[attendee.responseStatus ?? ""],
      }),
    );
  }

  for (const minutes of event.reminders ?? []) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Reminder",
      `TRIGGER:${formatTrigger(minutes)}`,
      "END:VALARM",
    );
  }

  lines.push("END:VEVENT");
  return foldLines(lines);
}

/** Escapes a TEXT value: backslash, semicolon, comma and line breaks. */
export function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds lines longer than 75 octets, never splitting a UTF-8 character. */
export function foldLines(lines: string[]) {
  return lines.flatMap(foldLine);
}

function foldLine(line: string): string[] {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return [line];

  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  // Continuation lines start with a space, which counts toward the limit.
  let limit = 75;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (currentBytes + bytes > limit) {
      parts.push(parts.length === 0 ? current : ` ${current}`);
      current = "";
      currentBytes = 0;
      limit = 74;
    }
    current += character;
    currentBytes += bytes;
  }
  parts.push(parts.length === 0 ? current : ` ${current}`);
  return parts;
}

function formatDateProperty(
  name: string,
  instant: Date,
  { isAllDay, zone }: { isAllDay: boolean; zone: string | null },
) {
  if (isAllDay) return `${name};VALUE=DATE:${formatDate(instant)}`;
  if (!zone) return `${name}:${formatUtc(instant)}`;
  return `${name};TZID=${zone}:${formatInZone(instant, zone)}`;
}

/**
 * Timed events are written in UTC, except series, whose wall-clock time has to
 * follow the zone across daylight saving changes.
 */
function getEventZone(event: IcsExportEvent) {
  const isSeriesPart = Boolean(
    event.recurrence?.length || event.originalStartTime,
  );
  if (event.isAllDay || !isSeriesPart) return null;
  return event.timezone &&
    event.timezone !== "UTC" &&
    isValidTimeZone(event.timezone)
    ? event.timezone
    : null;
}

function getRecurringZones(event: IcsExportEvent) {
  const zones = new Set<string>();
  const zone = getEventZone(event);
  if (zone) zones.add(zone);
  for (const line of event.recurrence ?? []) {
    const match = /;TZID=([^:;]+)/.exec(line);
    if (match && match[1] !== "UTC" && isValidTimeZone(match[1])) {
      zones.add(match[1]);
    }
  }
  return zones;
}

function getAllDayEnd(event: IcsExportEvent) {
  return event.end.getTime() > event.start.getTime()
    ? event.end
    : new Date(event.start.getTime() + 86_400_000);
}

function formatPerson(
  name: "ORGANIZER" | "ATTENDEE",
  person: { email: string; name?: string | null },
  options: { partstat?: string } = {},
) {
  const params = [
    person.name ? `CN=${quoteParam(person.name)}` : null,
    options.partstat ? `PARTSTAT=${options.partstat}` : null,
  ].filter(Boolean);
  return `${name}${params.length ? `;${params.join(";")}` : ""}:mailto:${person.email}`;
}

function quoteParam(value: string) {
  return `"${value.replace(/["\r\n]/g, "")}"`;
}

function formatTrigger(minutes: number) {
  if (minutes === 0) return "PT0S";
  const abs = Math.abs(Math.round(minutes));
  const days = Math.floor(abs / 1440);
  const hours = Math.floor((abs % 1440) / 60);
  const rest = abs % 60;
  const time = `${hours ? `${hours}H` : ""}${rest ? `${rest}M` : ""}`;
  const duration = `P${days ? `${days}D` : ""}${time ? `T${time}` : ""}`;
  return minutes > 0 ? `-${duration}` : duration;
}

function formatUtc(date: Date) {
  return `${formatDate(date)}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function formatDate(date: Date) {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

function formatInZone(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}T${get("hour")}${get("minute")}${get("second")}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
