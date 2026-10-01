import { describe, expect, it } from "vitest";
import {
  buildIcs,
  escapeText,
  foldLines,
  type IcsExportEvent,
} from "./build-ics";
import { IcsParseError, parseIcs } from "./parse-ics";
import { buildVTimezone } from "./vtimezone";

const now = new Date("2026-10-01T10:00:00Z");

function event(overrides: Partial<IcsExportEvent> = {}): IcsExportEvent {
  return {
    uid: "uid-1@example.com",
    title: "Planning",
    start: new Date("2026-10-05T09:00:00Z"),
    end: new Date("2026-10-05T10:00:00Z"),
    isAllDay: false,
    ...overrides,
  };
}

describe("buildIcs", () => {
  it("writes a timed event in UTC", () => {
    const ics = buildIcs({ events: [event()], now });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261005T090000Z");
    expect(ics).toContain("DTEND:20261005T100000Z");
    expect(ics).toContain("TRANSP:OPAQUE");
  });

  it("writes all-day events as dates with an exclusive end", () => {
    const ics = buildIcs({
      events: [
        event({
          isAllDay: true,
          start: new Date("2026-10-05T00:00:00Z"),
          end: new Date("2026-10-07T00:00:00Z"),
        }),
        event({
          uid: "uid-2",
          isAllDay: true,
          start: new Date("2026-10-09T00:00:00Z"),
          end: new Date("2026-10-09T00:00:00Z"),
        }),
      ],
      now,
    });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261005");
    expect(ics).toContain("DTEND;VALUE=DATE:20261007");
    expect(ics).toContain("DTEND;VALUE=DATE:20261010");
  });

  it("keeps a series in its zone with a VTIMEZONE and its rules", () => {
    const ics = buildIcs({
      events: [
        event({
          start: new Date("2026-10-05T07:00:00Z"),
          end: new Date("2026-10-05T08:00:00Z"),
          timezone: "Europe/Rome",
          recurrence: [
            "RRULE:FREQ=WEEKLY;BYDAY=MO",
            "EXDATE;TZID=Europe/Rome:20261012T090000",
          ],
        }),
      ],
      now,
    });
    expect(ics).toContain("BEGIN:VTIMEZONE\r\nTZID:Europe/Rome");
    expect(ics).toContain("DTSTART;TZID=Europe/Rome:20261005T090000");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(ics).toContain("EXDATE;TZID=Europe/Rome:20261012T090000");
  });

  it("marks an exception with RECURRENCE-ID", () => {
    const ics = buildIcs({
      events: [
        event({
          timezone: "Europe/Rome",
          originalStartTime: new Date("2026-10-12T07:00:00Z"),
        }),
      ],
      now,
    });
    expect(ics).toContain("RECURRENCE-ID;TZID=Europe/Rome:20261012T090000");
  });

  it("writes reminders, attendees and status", () => {
    const ics = buildIcs({
      events: [
        event({
          reminders: [10, 90, 1440],
          status: "TENTATIVE",
          isBusy: false,
          organizer: { email: "boss@example.com", name: "The Boss" },
          attendees: [
            {
              email: "a@example.com",
              name: "Ann",
              responseStatus: "accepted",
            },
          ],
        }),
      ],
      now,
    });
    expect(ics).toContain("TRIGGER:-PT10M");
    expect(ics).toContain("TRIGGER:-PT1H30M");
    expect(ics).toContain("TRIGGER:-P1D");
    expect(ics).toContain("STATUS:TENTATIVE");
    expect(ics).toContain("TRANSP:TRANSPARENT");
    expect(ics).toContain('ORGANIZER;CN="The Boss":mailto:boss@example.com');
    expect(ics).toContain(
      'ATTENDEE;CN="Ann";PARTSTAT=ACCEPTED:mailto:a@example.com',
    );
  });

  it("escapes text and folds long lines by octets", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");

    const long = `${"è".repeat(100)}`;
    const folded = foldLines([`SUMMARY:${long}`]);
    expect(folded.length).toBeGreaterThan(1);
    const encoder = new TextEncoder();
    for (const line of folded) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(folded.slice(1).every((line) => line.startsWith(" "))).toBe(true);
    expect(
      folded.map((line, index) => (index ? line.slice(1) : line)).join(""),
    ).toBe(`SUMMARY:${long}`);
  });
});

describe("buildVTimezone", () => {
  it("describes the daylight saving rules of a zone", () => {
    const lines = buildVTimezone("Europe/Rome", 2026);
    expect(lines).toContain("BEGIN:DAYLIGHT");
    expect(lines).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU");
    expect(lines).toContain("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU");
    expect(lines).toContain("TZOFFSETTO:+0200");
    expect(lines).toContain("DTSTART:20260329T020000");
    expect(lines).toContain("DTSTART:20261025T030000");
  });

  it("uses the second Sunday for US spring changes", () => {
    const lines = buildVTimezone("America/New_York", 2026);
    expect(lines).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU");
    expect(lines).toContain("RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU");
  });

  it("emits one fixed observance for a zone without daylight saving", () => {
    const lines = buildVTimezone("Asia/Tokyo", 2026);
    expect(lines.filter((line) => line.startsWith("BEGIN:"))).toEqual([
      "BEGIN:VTIMEZONE",
      "BEGIN:STANDARD",
    ]);
    expect(lines).toContain("TZOFFSETTO:+0900");
  });
});

describe("export then parse", () => {
  it("round-trips timed, all-day and recurring events", () => {
    const ics = buildIcs({
      events: [
        event({
          description: "Line one\nLine two, with; marks",
          location: "Room 4",
        }),
        event({
          uid: "allday",
          title: "Holiday",
          isAllDay: true,
          start: new Date("2026-12-25T00:00:00Z"),
          end: new Date("2026-12-26T00:00:00Z"),
        }),
        event({
          uid: "series",
          title: "Standup",
          start: new Date("2026-10-05T07:00:00Z"),
          end: new Date("2026-10-05T07:30:00Z"),
          timezone: "Europe/Rome",
          recurrence: ["RRULE:FREQ=DAILY;COUNT=3"],
          reminders: [15],
        }),
      ],
      now,
    });

    const parsed = parseIcs(ics);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({
      uid: "uid-1@example.com",
      title: "Planning",
      description: "Line one\nLine two, with; marks",
      location: "Room 4",
      start: new Date("2026-10-05T09:00:00Z"),
      end: new Date("2026-10-05T10:00:00Z"),
      isAllDay: false,
    });
    expect(parsed[1]).toMatchObject({
      isAllDay: true,
      start: new Date("2026-12-25T00:00:00Z"),
      end: new Date("2026-12-26T00:00:00Z"),
    });
    expect(parsed[2]).toMatchObject({
      timeZone: "Europe/Rome",
      start: new Date("2026-10-05T07:00:00Z"),
      recurrence: ["RRULE:FREQ=DAILY;COUNT=3"],
      reminders: [15],
    });
  });
});

describe("parseIcs", () => {
  const wrap = (body: string) =>
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//t//EN",
      body,
      "END:VCALENDAR",
    ].join("\r\n");

  it("reads a Windows time zone from the file's VTIMEZONE", () => {
    const text = wrap(
      [
        "BEGIN:VTIMEZONE",
        "TZID:W. Europe Standard Time",
        "BEGIN:STANDARD",
        "DTSTART:16011028T030000",
        "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
        "TZOFFSETFROM:+0200",
        "TZOFFSETTO:+0100",
        "END:STANDARD",
        "BEGIN:DAYLIGHT",
        "DTSTART:16010325T020000",
        "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
        "TZOFFSETFROM:+0100",
        "TZOFFSETTO:+0200",
        "END:DAYLIGHT",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "UID:outlook-1",
        "DTSTART;TZID=W. Europe Standard Time:20261005T090000",
        "DTEND;TZID=W. Europe Standard Time:20261005T100000",
        "SUMMARY:Outlook meeting",
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const [parsed] = parseIcs(text);
    expect(parsed.start).toEqual(new Date("2026-10-05T07:00:00Z"));
    expect(parsed.end).toEqual(new Date("2026-10-05T08:00:00Z"));
    expect(parsed.timeZone).toBeNull();
    expect(parsed.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
  });

  it("applies the zone's offset on the event date, not a fixed one", () => {
    const text = wrap(
      [
        "BEGIN:VEVENT",
        "UID:a",
        "DTSTART;TZID=America/New_York:20260115T090000",
        "DURATION:PT45M",
        "SUMMARY:Winter",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const [parsed] = parseIcs(text);
    expect(parsed.start).toEqual(new Date("2026-01-15T14:00:00Z"));
    expect(parsed.end).toEqual(new Date("2026-01-15T14:45:00Z"));
    expect(parsed.timeZone).toBe("America/New_York");
  });

  it("reads floating times in the given zone and UTC times as is", () => {
    const text = wrap(
      [
        "BEGIN:VEVENT",
        "UID:floating",
        "DTSTART:20261005T090000",
        "DTEND:20261005T100000",
        "SUMMARY:Floating",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:utc",
        "DTSTART:20261005T090000Z",
        "DTEND:20261005T100000Z",
        "SUMMARY:UTC",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const [floating, utc] = parseIcs(text, {
      floatingTimeZone: "Europe/Rome",
    });
    expect(floating.start).toEqual(new Date("2026-10-05T07:00:00Z"));
    expect(utc.start).toEqual(new Date("2026-10-05T09:00:00Z"));
  });

  it("reads status, transparency, people, alarms and exceptions", () => {
    const text = wrap(
      [
        "BEGIN:VEVENT",
        "UID:x",
        "RECURRENCE-ID:20261012T090000Z",
        "DTSTART:20261012T100000Z",
        "DTEND:20261012T110000Z",
        "SUMMARY:Moved",
        "STATUS:TENTATIVE",
        "TRANSP:TRANSPARENT",
        'ORGANIZER;CN="Boss":mailto:boss@example.com',
        "ATTENDEE;CN=Ann;PARTSTAT=DECLINED:mailto:ann@example.com",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "TRIGGER:-PT30M",
        "END:VALARM",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "TRIGGER;RELATED=END:-PT5M",
        "END:VALARM",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const [parsed] = parseIcs(text);
    expect(parsed).toMatchObject({
      status: "TENTATIVE",
      isBusy: false,
      recurrenceId: new Date("2026-10-12T09:00:00Z"),
      organizer: { email: "boss@example.com", name: "Boss" },
      attendees: [
        { email: "ann@example.com", name: "Ann", responseStatus: "declined" },
      ],
      reminders: [30],
    });
  });

  it("skips events without a start", () => {
    const text = wrap(
      [
        "BEGIN:VEVENT",
        "UID:no-start",
        "SUMMARY:Broken",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:ok",
        "DTSTART:20261005T090000Z",
        "SUMMARY:Fine",
        "END:VEVENT",
      ].join("\r\n"),
    );
    expect(parseIcs(text).map((item) => item.uid)).toEqual(["ok"]);
  });

  it("enforces size limits and rejects garbage", () => {
    const text = wrap(
      [
        "BEGIN:VEVENT",
        "UID:1",
        "DTSTART:20261005T090000Z",
        "SUMMARY:One",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:2",
        "DTSTART:20261005T090000Z",
        "SUMMARY:Two",
        "END:VEVENT",
      ].join("\r\n"),
    );
    expect(() => parseIcs(text, { maxBytes: 50 })).toThrowError(
      expect.objectContaining({ code: "too_large" }),
    );
    expect(() => parseIcs(text, { maxEvents: 1 })).toThrowError(
      expect.objectContaining({ code: "too_many_events" }),
    );
    expect(() => parseIcs("not a calendar")).toThrow(IcsParseError);
    expect(() => parseIcs(wrap(""))).toThrowError(
      expect.objectContaining({ code: "empty" }),
    );
  });
});
