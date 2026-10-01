import { describe, expect, it } from "vitest";
import {
  calendarPreferencesSchema,
  DEFAULT_CALENDAR_PREFERENCES,
  resolveCalendarPreferences,
} from "./preferences";
import {
  formatClockTime,
  formatDuration,
  formatHourLabel,
  formatMinutes,
} from "./format";
import {
  getMonthGridRange,
  getWeekDateKeys,
  getWeekdayOrder,
  startOfWeekKey,
} from "./week-range";
import { isWorkingHour, parseTimeOfDay } from "./working-hours";

describe("resolveCalendarPreferences", () => {
  it("returns the defaults for missing or malformed storage", () => {
    expect(resolveCalendarPreferences(null)).toEqual(
      DEFAULT_CALENDAR_PREFERENCES,
    );
    expect(resolveCalendarPreferences([])).toEqual(
      DEFAULT_CALENDAR_PREFERENCES,
    );
    expect(resolveCalendarPreferences({})).toEqual(
      DEFAULT_CALENDAR_PREFERENCES,
    );
  });

  it("keeps valid keys and drops invalid ones individually", () => {
    const result = resolveCalendarPreferences({
      weekStart: "sunday",
      timeFormat: "banana",
      defaultDurationMinutes: 45,
      secondaryTimeZone: "Not/AZone",
    });
    expect(result.weekStart).toBe("sunday");
    expect(result.timeFormat).toBe("24h");
    expect(result.defaultDurationMinutes).toBe(45);
    expect(result.secondaryTimeZone).toBeNull();
  });

  it("falls back to default hours when the range is empty", () => {
    const result = resolveCalendarPreferences({
      workingHours: { start: "18:00", end: "09:00" },
    });
    expect(result.workingHours).toEqual({ start: "09:00", end: "17:00" });
  });

  it("validates a full object", () => {
    expect(
      calendarPreferencesSchema.safeParse(DEFAULT_CALENDAR_PREFERENCES).success,
    ).toBe(true);
    expect(
      calendarPreferencesSchema.safeParse({
        ...DEFAULT_CALENDAR_PREFERENCES,
        workingDays: [7],
      }).success,
    ).toBe(false);
  });
});

describe("week ranges", () => {
  // 2026-10-01 is a Thursday
  it("finds the week start for each preference", () => {
    expect(startOfWeekKey("2026-10-01", "monday")).toBe("2026-09-28");
    expect(startOfWeekKey("2026-10-01", "sunday")).toBe("2026-09-27");
    expect(startOfWeekKey("2026-10-01", "saturday")).toBe("2026-09-26");
  });

  it("keeps a week-start day in its own week", () => {
    expect(startOfWeekKey("2026-09-28", "monday")).toBe("2026-09-28");
    expect(startOfWeekKey("2026-09-27", "monday")).toBe("2026-09-21");
  });

  it("lists seven consecutive days across a year boundary", () => {
    expect(getWeekDateKeys("2026-12-31", "monday")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });

  it("orders weekdays by week start", () => {
    expect(getWeekdayOrder("monday")).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(getWeekdayOrder("saturday")).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });

  it("builds a month grid of whole weeks", () => {
    expect(getMonthGridRange("2026-10-15", "monday")).toEqual({
      startKey: "2026-09-28",
      endKey: "2026-11-01",
    });
    expect(getMonthGridRange("2026-10-15", "sunday")).toEqual({
      startKey: "2026-09-27",
      endKey: "2026-10-31",
    });
    expect(getMonthGridRange("2026-12-10", "monday")).toEqual({
      startKey: "2026-11-30",
      endKey: "2027-01-03",
    });
  });
});

describe("isWorkingHour", () => {
  const schedule = DEFAULT_CALENDAR_PREFERENCES;

  it("judges on the wall clock of the zone", () => {
    const instant = new Date("2026-10-01T07:30:00Z"); // Thursday
    expect(isWorkingHour({ instant, timeZone: "UTC", schedule })).toBe(false);
    expect(isWorkingHour({ instant, timeZone: "Europe/Rome", schedule })).toBe(
      true,
    );
  });

  it("excludes the end instant and non-working days", () => {
    expect(
      isWorkingHour({
        instant: new Date("2026-10-01T17:00:00Z"),
        timeZone: "UTC",
        schedule,
      }),
    ).toBe(false);
    expect(
      isWorkingHour({
        instant: new Date("2026-10-03T10:00:00Z"), // Saturday
        timeZone: "UTC",
        schedule,
      }),
    ).toBe(false);
  });

  it("parses times of day", () => {
    expect(parseTimeOfDay("09:30")).toBe(570);
  });
});

describe("formatting", () => {
  it("formats clock times in both styles", () => {
    const instant = new Date("2026-10-01T12:05:00Z");
    expect(
      formatClockTime({ instant, timeZone: "UTC", timeFormat: "24h" }),
    ).toBe("12:05");
    expect(
      formatClockTime({ instant, timeZone: "UTC", timeFormat: "12h" }),
    ).toBe("12:05 PM");
    expect(formatMinutes(0, "12h")).toBe("12:00 AM");
    expect(formatMinutes(13 * 60 + 7, "12h")).toBe("1:07 PM");
  });

  it("formats hour labels", () => {
    expect(formatHourLabel(0, "12h")).toBe("12 AM");
    expect(formatHourLabel(15, "12h")).toBe("3 PM");
    expect(formatHourLabel(7, "24h")).toBe("07:00");
  });

  it("formats durations", () => {
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(90)).toBe("1 h 30 min");
  });
});
