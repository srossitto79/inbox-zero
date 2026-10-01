import { describe, expect, it } from "vitest";
import { expandRecurringEvent, getSlotKey } from "./recurrence";

function iso(occurrences: { startTime: Date }[]) {
  return occurrences.map((occurrence) => occurrence.startTime.toISOString());
}

describe("expandRecurringEvent", () => {
  it("keeps the wall-clock time across a DST change", () => {
    // Weekly Monday 09:00 in Rome. Summer time began on 2026-03-29.
    const occurrences = expandRecurringEvent(
      {
        startTime: new Date("2026-03-16T08:00:00Z"),
        endTime: new Date("2026-03-16T09:00:00Z"),
        isAllDay: false,
        timezone: "Europe/Rome",
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      },
      {
        from: new Date("2026-03-20T00:00:00Z"),
        to: new Date("2026-04-07T00:00:00Z"),
      },
    );

    expect(iso(occurrences)).toEqual([
      "2026-03-23T08:00:00.000Z",
      "2026-03-30T07:00:00.000Z",
      "2026-04-06T07:00:00.000Z",
    ]);
    expect(occurrences[1].endTime.toISOString()).toBe(
      "2026-03-30T08:00:00.000Z",
    );
  });

  it("applies EXDATE and RDATE entries", () => {
    const occurrences = expandRecurringEvent(
      {
        startTime: new Date("2026-10-05T07:00:00Z"),
        endTime: new Date("2026-10-05T07:30:00Z"),
        isAllDay: false,
        timezone: "Europe/Rome",
        recurrence: [
          "RRULE:FREQ=DAILY;COUNT=4",
          "EXDATE;TZID=Europe/Rome:20261006T090000",
          "RDATE;TZID=Europe/Rome:20261020T150000",
        ],
      },
      {
        from: new Date("2026-10-01T00:00:00Z"),
        to: new Date("2026-11-01T00:00:00Z"),
      },
    );

    expect(iso(occurrences)).toEqual([
      "2026-10-05T07:00:00.000Z",
      "2026-10-07T07:00:00.000Z",
      "2026-10-08T07:00:00.000Z",
      "2026-10-20T13:00:00.000Z",
    ]);
  });

  it("reads a UTC EXDATE as a wall-clock time in the event zone", () => {
    const occurrences = expandRecurringEvent(
      {
        startTime: new Date("2026-10-05T07:00:00Z"),
        endTime: new Date("2026-10-05T08:00:00Z"),
        isAllDay: false,
        timezone: "Europe/Rome",
        recurrence: ["RRULE:FREQ=DAILY;COUNT=3", "EXDATE:20261006T070000Z"],
      },
      {
        from: new Date("2026-10-01T00:00:00Z"),
        to: new Date("2026-11-01T00:00:00Z"),
      },
    );

    expect(iso(occurrences)).toEqual([
      "2026-10-05T07:00:00.000Z",
      "2026-10-07T07:00:00.000Z",
    ]);
  });

  it("stops at a UTC UNTIL converted to the event zone", () => {
    // Last occurrence is 23:30 in New York, which is already the next UTC day.
    const occurrences = expandRecurringEvent(
      {
        startTime: new Date("2026-06-01T03:30:00Z"),
        endTime: new Date("2026-06-01T04:00:00Z"),
        isAllDay: false,
        timezone: "America/New_York",
        recurrence: ["RRULE:FREQ=DAILY;UNTIL=20260604T033000Z"],
      },
      {
        from: new Date("2026-05-31T00:00:00Z"),
        to: new Date("2026-07-01T00:00:00Z"),
      },
    );

    expect(iso(occurrences)).toEqual([
      "2026-06-01T03:30:00.000Z",
      "2026-06-02T03:30:00.000Z",
      "2026-06-03T03:30:00.000Z",
      "2026-06-04T03:30:00.000Z",
    ]);
  });

  it("expands multi-day all-day series as floating dates", () => {
    const occurrences = expandRecurringEvent(
      {
        startTime: new Date("2026-10-01T00:00:00Z"),
        endTime: new Date("2026-10-03T00:00:00Z"),
        isAllDay: true,
        timezone: "Europe/Rome",
        recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"],
      },
      {
        from: new Date("2026-10-01T00:00:00Z"),
        to: new Date("2026-11-01T00:00:00Z"),
      },
    );

    expect(iso(occurrences)).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-10-08T00:00:00.000Z",
      "2026-10-15T00:00:00.000Z",
    ]);
    expect(occurrences[0].endTime.toISOString()).toBe(
      "2026-10-03T00:00:00.000Z",
    );
  });

  it("includes an occurrence that began before the range but overlaps it", () => {
    const occurrences = expandRecurringEvent(
      {
        startTime: new Date("2026-10-05T22:00:00Z"),
        endTime: new Date("2026-10-06T02:00:00Z"),
        isAllDay: false,
        timezone: "UTC",
        recurrence: ["RRULE:FREQ=DAILY"],
      },
      {
        from: new Date("2026-10-07T00:00:00Z"),
        to: new Date("2026-10-07T12:00:00Z"),
      },
    );

    expect(iso(occurrences)).toEqual(["2026-10-06T22:00:00.000Z"]);
  });

  it("falls back to UTC when the stored time zone is unknown", () => {
    const occurrences = expandRecurringEvent(
      {
        startTime: new Date("2026-10-05T09:00:00Z"),
        endTime: new Date("2026-10-05T10:00:00Z"),
        isAllDay: false,
        timezone: "Not/AZone",
        recurrence: ["RRULE:FREQ=DAILY;COUNT=2"],
      },
      {
        from: new Date("2026-10-01T00:00:00Z"),
        to: new Date("2026-11-01T00:00:00Z"),
      },
    );

    expect(iso(occurrences)).toEqual([
      "2026-10-05T09:00:00.000Z",
      "2026-10-06T09:00:00.000Z",
    ]);
  });
});

describe("getSlotKey", () => {
  it("matches the key of the occurrence an exception replaces", () => {
    const [occurrence] = expandRecurringEvent(
      {
        startTime: new Date("2026-10-05T07:00:00Z"),
        endTime: new Date("2026-10-05T08:00:00Z"),
        isAllDay: false,
        timezone: "Europe/Rome",
        recurrence: ["RRULE:FREQ=DAILY;COUNT=1"],
      },
      {
        from: new Date("2026-10-01T00:00:00Z"),
        to: new Date("2026-11-01T00:00:00Z"),
      },
    );

    expect(
      getSlotKey({
        instant: new Date("2026-10-05T07:00:00Z"),
        timeZone: "Europe/Rome",
        isAllDay: false,
      }),
    ).toBe(occurrence.slotKey);
  });
});
