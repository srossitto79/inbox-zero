import { describe, expect, it } from "vitest";
import { getTimingProblem, shiftTiming } from "@/utils/calendar/write/timing";

describe("shiftTiming", () => {
  it("keeps the elapsed time of a timed event across a DST change", () => {
    // Rome springs forward on 2026-03-29; a one-hour event stays one hour.
    const moved = shiftTiming(
      {
        isAllDay: false,
        start: new Date("2026-03-28T14:00:00Z"),
        end: new Date("2026-03-28T15:00:00Z"),
        timeZone: "Europe/Rome",
      },
      new Date("2026-03-29T00:30:00Z"),
    );

    expect(moved).toMatchObject({
      isAllDay: false,
      start: new Date("2026-03-29T00:30:00Z"),
      end: new Date("2026-03-29T01:30:00Z"),
      timeZone: "Europe/Rome",
    });
  });

  it("keeps the number of days of an all-day event, over a month end", () => {
    expect(
      shiftTiming(
        { isAllDay: true, startDate: "2026-10-05", endDate: "2026-10-08" },
        "2026-10-30",
      ),
    ).toEqual({
      isAllDay: true,
      startDate: "2026-10-30",
      endDate: "2026-11-02",
    });
  });

  it("rejects the wrong kind of start", () => {
    expect(() =>
      shiftTiming(
        { isAllDay: true, startDate: "2026-10-05", endDate: "2026-10-06" },
        new Date(),
      ),
    ).toThrow();
    expect(() =>
      shiftTiming(
        {
          isAllDay: false,
          start: new Date(),
          end: new Date(Date.now() + 1000),
          timeZone: "UTC",
        },
        "2026-10-05",
      ),
    ).toThrow();
  });
});

describe("getTimingProblem", () => {
  it("accepts valid timings", () => {
    expect(
      getTimingProblem({
        isAllDay: false,
        start: new Date("2026-10-05T07:00:00Z"),
        end: new Date("2026-10-05T08:00:00Z"),
        timeZone: "Europe/Rome",
      }),
    ).toBeNull();
    expect(
      getTimingProblem({
        isAllDay: true,
        startDate: "2026-10-05",
        endDate: "2026-10-06",
      }),
    ).toBeNull();
  });

  it("flags empty ranges, bad dates and unknown zones", () => {
    const instant = new Date("2026-10-05T07:00:00Z");
    expect(
      getTimingProblem({
        isAllDay: false,
        start: instant,
        end: instant,
        timeZone: "UTC",
      }),
    ).toBe("End must be after start");
    expect(
      getTimingProblem({
        isAllDay: true,
        startDate: "2026-10-05",
        endDate: "2026-10-05",
      }),
    ).toBe("End must be after start");
    expect(
      getTimingProblem({
        isAllDay: true,
        startDate: "nope",
        endDate: "2026-10-05",
      }),
    ).toBe("Invalid date");
    expect(
      getTimingProblem({
        isAllDay: false,
        start: instant,
        end: new Date("2026-10-05T08:00:00Z"),
        timeZone: "Mars/Base",
      }),
    ).toBe("Invalid time zone");
  });
});
