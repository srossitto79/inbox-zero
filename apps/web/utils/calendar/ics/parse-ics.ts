import ICAL from "ical.js";
import {
  isValidTimeZone,
  wallClockToInstant,
} from "@/utils/calendar/zoned-time";

export const ICS_MAX_BYTES = 2 * 1024 * 1024;
export const ICS_MAX_EVENTS = 5000;

export type ParsedIcsEvent = {
  uid: string;
  title: string;
  description: string | null;
  location: string | null;
  /** All-day events carry UTC midnight instants; `end` is exclusive. */
  start: Date;
  end: Date;
  isAllDay: boolean;
  /** IANA zone of the start, or null for UTC, floating and unknown zones. */
  timeZone: string | null;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  isBusy: boolean;
  /** RRULE, EXDATE and RDATE lines, unfolded. */
  recurrence: string[];
  /** Slot an exception replaces. */
  recurrenceId: Date | null;
  organizer: { email: string; name: string | null } | null;
  attendees: {
    email: string;
    name: string | null;
    responseStatus: "accepted" | "declined" | "tentative" | "needsAction";
  }[];
  /** Minutes before the start, for alarms relative to it. */
  reminders: number[];
  url: string | null;
};

export type IcsParseErrorCode =
  | "too_large"
  | "too_many_events"
  | "invalid"
  | "empty";

export class IcsParseError extends Error {
  readonly code: IcsParseErrorCode;
  constructor(code: IcsParseErrorCode, message: string) {
    super(message);
    this.name = "IcsParseError";
    this.code = code;
  }
}

/**
 * Normalizes the VEVENTs of an iCalendar file. Time zones are resolved from
 * IANA ids first and from the file's own VTIMEZONE definitions otherwise
 * (Outlook uses Windows names). Floating times are read in `floatingTimeZone`.
 */
export function parseIcs(
  text: string,
  {
    floatingTimeZone = "UTC",
    maxBytes = ICS_MAX_BYTES,
    maxEvents = ICS_MAX_EVENTS,
  }: { floatingTimeZone?: string; maxBytes?: number; maxEvents?: number } = {},
): ParsedIcsEvent[] {
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new IcsParseError("too_large", "Calendar file is too large");
  }

  let calendar: ICAL.Component;
  try {
    calendar = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new IcsParseError("invalid", "Calendar file is not valid");
  }
  if (calendar.name !== "vcalendar") {
    throw new IcsParseError("invalid", "Calendar file is not valid");
  }

  const vevents = calendar.getAllSubcomponents("vevent");
  if (vevents.length === 0) {
    throw new IcsParseError("empty", "Calendar file has no events");
  }
  if (vevents.length > maxEvents) {
    throw new IcsParseError(
      "too_many_events",
      "Calendar file has too many events",
    );
  }

  const zones = new Map<string, ICAL.Timezone>();
  for (const vtimezone of calendar.getAllSubcomponents("vtimezone")) {
    const zone = new ICAL.Timezone(vtimezone);
    zones.set(zone.tzid, zone);
  }
  const context = { zones, floatingTimeZone };

  return vevents.flatMap((vevent) => {
    const parsed = parseEvent(vevent, context);
    return parsed ? [parsed] : [];
  });
}

type ParseContext = {
  zones: Map<string, ICAL.Timezone>;
  floatingTimeZone: string;
};

function parseEvent(
  vevent: ICAL.Component,
  context: ParseContext,
): ParsedIcsEvent | null {
  const dtstart = vevent.getFirstProperty("dtstart");
  const startValue = dtstart?.getFirstValue();
  if (!dtstart || !(startValue instanceof ICAL.Time)) return null;

  const isAllDay = startValue.isDate;
  const start = toInstant(dtstart, context);

  const dtend = vevent.getFirstProperty("dtend");
  const durationValue = vevent.getFirstPropertyValue("duration");
  let end: Date;
  if (dtend && dtend.getFirstValue() instanceof ICAL.Time) {
    end = toInstant(dtend, context);
  } else if (durationValue instanceof ICAL.Duration) {
    end = new Date(start.getTime() + durationValue.toSeconds() * 1000);
  } else {
    end = new Date(start.getTime() + (isAllDay ? 86_400_000 : 0));
  }
  if (isAllDay && end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 86_400_000);
  }

  const recurrenceIdProperty = vevent.getFirstProperty("recurrence-id");
  const tzid = getTzid(dtstart);

  return {
    uid: text(vevent, "uid") ?? "",
    title: text(vevent, "summary") ?? "",
    description: text(vevent, "description"),
    location: text(vevent, "location"),
    start,
    end,
    isAllDay,
    timeZone:
      !isAllDay && tzid && isValidTimeZone(tzid) && tzid !== "UTC"
        ? tzid
        : null,
    status: parseStatus(text(vevent, "status")),
    isBusy: text(vevent, "transp")?.toUpperCase() !== "TRANSPARENT",
    recurrence: ["rrule", "exdate", "rdate"].flatMap((name) =>
      vevent.getAllProperties(name).map(unfoldedLine),
    ),
    recurrenceId: recurrenceIdProperty
      ? toInstant(recurrenceIdProperty, context)
      : null,
    organizer: parseOrganizer(vevent),
    attendees: vevent.getAllProperties("attendee").flatMap(parseAttendee),
    reminders: vevent
      .getAllSubcomponents("valarm")
      .flatMap((alarm) => parseReminder(alarm)),
    url: text(vevent, "url"),
  };
}

function toInstant(property: ICAL.Property, context: ParseContext): Date {
  const time = property.getFirstValue() as ICAL.Time;
  const wall = {
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.isDate ? 0 : time.hour,
    minute: time.isDate ? 0 : time.minute,
    second: time.isDate ? 0 : time.second,
  };
  if (time.isDate) {
    return new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  }

  const tzid = getTzid(property);
  if (time.zone === ICAL.Timezone.utcTimezone || tzid === "UTC") {
    return new Date(
      Date.UTC(
        wall.year,
        wall.month - 1,
        wall.day,
        wall.hour,
        wall.minute,
        wall.second,
      ),
    );
  }
  if (tzid && isValidTimeZone(tzid)) return wallClockToInstant(wall, tzid);

  const definition = tzid ? context.zones.get(tzid) : undefined;
  if (definition) {
    const local = new ICAL.Time({ ...wall, isDate: false });
    const offsetSeconds = definition.utcOffset(local);
    return new Date(
      Date.UTC(
        wall.year,
        wall.month - 1,
        wall.day,
        wall.hour,
        wall.minute,
        wall.second,
      ) -
        offsetSeconds * 1000,
    );
  }

  const fallback = isValidTimeZone(context.floatingTimeZone)
    ? context.floatingTimeZone
    : "UTC";
  return wallClockToInstant(wall, fallback);
}

function getTzid(property: ICAL.Property) {
  const tzid = property.getParameter("tzid");
  return typeof tzid === "string" ? tzid : null;
}

function text(vevent: ICAL.Component, name: string) {
  const value = vevent.getFirstPropertyValue(name);
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result ? result : null;
}

function unfoldedLine(property: ICAL.Property) {
  return property.toICALString().replace(/\r?\n[ \t]/g, "");
}

function parseStatus(value: string | null): ParsedIcsEvent["status"] {
  const upper = value?.toUpperCase();
  if (upper === "TENTATIVE" || upper === "CANCELLED") return upper;
  return "CONFIRMED";
}

function parseOrganizer(vevent: ICAL.Component) {
  const property = vevent.getFirstProperty("organizer");
  const email = property ? mailtoAddress(property.getFirstValue()) : null;
  if (!property || !email) return null;
  const name = property.getParameter("cn");
  return { email, name: typeof name === "string" && name ? name : null };
}

function parseAttendee(property: ICAL.Property) {
  const email = mailtoAddress(property.getFirstValue());
  if (!email) return [];
  const name = property.getParameter("cn");
  const partstat = String(
    property.getParameter("partstat") ?? "",
  ).toUpperCase();
  const responseStatus =
    partstat === "ACCEPTED"
      ? "accepted"
      : partstat === "DECLINED"
        ? "declined"
        : partstat === "TENTATIVE"
          ? "tentative"
          : "needsAction";
  return [
    {
      email,
      name: typeof name === "string" && name ? name : null,
      responseStatus,
    } as const,
  ];
}

function mailtoAddress(value: unknown) {
  if (typeof value !== "string") return null;
  const address = value.replace(/^mailto:/i, "").trim();
  return address.includes("@") ? address : null;
}

function parseReminder(alarm: ICAL.Component) {
  const trigger = alarm.getFirstProperty("trigger");
  const value = trigger?.getFirstValue();
  if (!trigger || !(value instanceof ICAL.Duration)) return [];
  if (trigger.getParameter("related")?.toString().toUpperCase() === "END") {
    return [];
  }
  const minutes = Math.round(-value.toSeconds() / 60);
  return minutes >= 0 ? [minutes] : [];
}
