import { describe, expect, it } from "vitest";
import { DEFAULT_CALENDAR_PREFERENCES } from "@/utils/calendar/preferences/preferences";
import {
  getHourHeight,
  getMonthCellHeight,
  getSecondaryHourLabels,
  getWorkingHourFlags,
} from "./time-grid";

const ROME = "Europe/Rome";

describe("getHourHeight", () => {
  it("gives a shorter row to the compact density", () => {
    expect(getHourHeight("compact")).toBeLessThan(getHourHeight("comfortable"));
  });
});

describe("getMonthCellHeight", () => {
  it("differs between densities", () => {
    expect(getMonthCellHeight("compact")).not.toBe(
      getMonthCellHeight("comfortable"),
    );
  });
});

describe("getWorkingHourFlags", () => {
  it("marks the hours the schedule covers", () => {
    const flags = getWorkingHourFlags({
      dateKey: "2026-10-01", // Thursday
      timeZone: ROME,
      schedule: DEFAULT_CALENDAR_PREFERENCES,
    });
    expect(flags).toHaveLength(24);
    const working = flags
      .map((working, hour) => (working ? hour : null))
      .filter((hour) => hour !== null);
    expect(working).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it("marks a non-working day as entirely off-hours", () => {
    const flags = getWorkingHourFlags({
      dateKey: "2026-10-03", // Saturday
      timeZone: ROME,
      schedule: DEFAULT_CALENDAR_PREFERENCES,
    });
    expect(flags.some(Boolean)).toBe(false);
  });
});

describe("getSecondaryHourLabels", () => {
  it("indexes labels by the primary zone's hour", () => {
    // Rome is two ahead of UTC in October, so Rome 09:00 is 07:00 UTC.
    const labels = getSecondaryHourLabels({
      dateKey: "2026-10-01",
      primaryTimeZone: ROME,
      secondaryTimeZone: "UTC",
      timeFormat: "24h",
    });
    expect(labels).toHaveLength(24);
    expect(labels[9]).toBe("07:00");
    expect(labels[0]).toBe("22:00");
  });

  it("follows the time format", () => {
    const labels = getSecondaryHourLabels({
      dateKey: "2026-10-01",
      primaryTimeZone: ROME,
      secondaryTimeZone: "UTC",
      timeFormat: "12h",
    });
    expect(labels[9]).toBe("7 AM");
  });
});
