import { describe, expect, it } from "vitest";
import {
  expandStoredEvents,
  parseAttendees,
  type StoredCalendarEvent,
} from "./expand-events";

const calendars = new Map([
  ["cal-1", { id: "cal-1", name: "Work", color: "#4285f4" }],
]);

function row(overrides: Partial<StoredCalendarEvent>): StoredCalendarEvent {
  return {
    id: "row-1",
    calendarId: "cal-1",
    providerEventId: "evt-1",
    title: "Event",
    description: null,
    location: null,
    startTime: new Date("2026-10-05T07:00:00Z"),
    endTime: new Date("2026-10-05T08:00:00Z"),
    isAllDay: false,
    timezone: "Europe/Rome",
    status: "CONFIRMED",
    isBusy: true,
    organizerEmail: null,
    organizerName: null,
    isOrganizer: false,
    selfResponseStatus: null,
    attendees: null,
    recurringEventId: null,
    recurrence: [],
    originalStartTime: null,
    videoLink: null,
    htmlLink: null,
    reminders: null,
    ...overrides,
  };
}

const october = {
  from: new Date("2026-10-01T00:00:00Z"),
  to: new Date("2026-11-01T00:00:00Z"),
};

function expand(events: StoredCalendarEvent[], viewerTimeZone = "Europe/Rome") {
  return expandStoredEvents({
    events,
    calendars,
    range: october,
    viewerTimeZone,
  });
}

describe("expandStoredEvents", () => {
  it("returns plain events with their calendar attached", () => {
    const [event] = expand([row({ title: "Standup" })]);

    expect(event).toMatchObject({
      id: "row-1",
      title: "Standup",
      calendarName: "Work",
      calendarColor: "#4285f4",
      isRecurring: false,
      start: "2026-10-05T07:00:00.000Z",
    });
  });

  it("hides cancelled events and events from unknown calendars", () => {
    expect(
      expand([
        row({ id: "a", status: "CANCELLED" }),
        row({ id: "b", calendarId: "other" }),
      ]),
    ).toEqual([]);
  });

  it("expands a series and applies a moved and a cancelled instance", () => {
    const master = row({
      id: "master",
      providerEventId: "series",
      recurrence: ["RRULE:FREQ=DAILY;COUNT=4"],
    });
    const moved = row({
      id: "moved",
      providerEventId: "series_20261006",
      recurringEventId: "series",
      originalStartTime: new Date("2026-10-06T07:00:00Z"),
      startTime: new Date("2026-10-06T13:00:00Z"),
      endTime: new Date("2026-10-06T14:00:00Z"),
      title: "Moved",
    });
    const cancelled = row({
      id: "cancelled",
      providerEventId: "series_20261007",
      recurringEventId: "series",
      originalStartTime: new Date("2026-10-07T07:00:00Z"),
      status: "CANCELLED",
    });

    const events = expand([master, moved, cancelled]);

    expect(events.map((event) => [event.title, event.start])).toEqual([
      ["Event", "2026-10-05T07:00:00.000Z"],
      ["Moved", "2026-10-06T13:00:00.000Z"],
      ["Event", "2026-10-08T07:00:00.000Z"],
    ]);
    expect(events.every((event) => event.isRecurring)).toBe(true);
    expect(new Set(events.map((event) => event.id)).size).toBe(3);
  });

  it("does not show a series whose master is cancelled", () => {
    expect(
      expand([
        row({
          status: "CANCELLED",
          recurrence: ["RRULE:FREQ=DAILY;COUNT=3"],
        }),
      ]),
    ).toEqual([]);
  });

  it("returns all-day events as floating dates", () => {
    const [event] = expand([
      row({
        isAllDay: true,
        startTime: new Date("2026-10-10T00:00:00Z"),
        endTime: new Date("2026-10-12T00:00:00Z"),
      }),
    ]);

    expect(event.start).toBe("2026-10-10");
    expect(event.end).toBe("2026-10-12");
  });

  it("keeps an all-day event that touches the range edge in the viewer zone", () => {
    // Sunday 2026-10-04 ends at the start of Monday 2026-10-05 in Los Angeles
    // (07:00 UTC), so a range starting then excludes it.
    const allDay = row({
      isAllDay: true,
      startTime: new Date("2026-10-04T00:00:00Z"),
      endTime: new Date("2026-10-05T00:00:00Z"),
    });
    const base = {
      calendars,
      viewerTimeZone: "America/Los_Angeles",
      events: [allDay],
    };

    expect(
      expandStoredEvents({
        ...base,
        range: {
          from: new Date("2026-10-05T07:00:00Z"),
          to: new Date("2026-10-12T07:00:00Z"),
        },
      }),
    ).toEqual([]);
    expect(
      expandStoredEvents({
        ...base,
        range: {
          from: new Date("2026-09-28T07:00:00Z"),
          to: new Date("2026-10-05T07:00:00Z"),
        },
      }),
    ).toHaveLength(1);
  });

  it("expands an all-day series on the same dates in every zone", () => {
    const series = row({
      isAllDay: true,
      startTime: new Date("2026-10-05T00:00:00Z"),
      endTime: new Date("2026-10-06T00:00:00Z"),
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=2"],
    });

    expect(
      expand([series], "Pacific/Auckland").map((event) => event.start),
    ).toEqual(["2026-10-05", "2026-10-12"]);
  });

  it("orders all-day events before timed events", () => {
    const events = expand([
      row({ id: "timed" }),
      row({
        id: "all-day",
        isAllDay: true,
        startTime: new Date("2026-10-05T00:00:00Z"),
        endTime: new Date("2026-10-06T00:00:00Z"),
      }),
    ]);

    expect(events.map((event) => event.id)).toEqual(["all-day", "timed"]);
  });
});

describe("parseAttendees", () => {
  it("drops malformed entries instead of throwing", () => {
    expect(
      parseAttendees([
        { email: "a@example.com", name: "A", responseStatus: "accepted" },
        { name: "No email" },
        null,
        "text",
      ]),
    ).toEqual([
      {
        email: "a@example.com",
        name: "A",
        responseStatus: "accepted",
        isSelf: undefined,
        isOrganizer: undefined,
      },
    ]);
    expect(parseAttendees(undefined)).toEqual([]);
  });
});
