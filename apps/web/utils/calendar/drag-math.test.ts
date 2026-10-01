import { describe, expect, it } from "vitest";
import {
  computeClickSlot,
  computeCreateRange,
  findColumnIndex,
  minutesToInstant,
  moveEventByDays,
  moveTimedEvent,
  pixelsToMinutes,
  resizeTimedEvent,
  snapMinutes,
} from "@/utils/calendar/drag-math";

const ROME = "Europe/Rome";
const iso = (date: Date) => date.toISOString();

describe("snapMinutes", () => {
  it("rounds to the nearest quarter hour", () => {
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(22)).toBe(15);
    expect(snapMinutes(23)).toBe(30);
    expect(snapMinutes(-8)).toBe(-15);
  });
});

describe("pixelsToMinutes", () => {
  it("converts pointer offsets and clamps to the day", () => {
    expect(
      pixelsToMinutes({ pointerY: 164, columnTop: 100, hourHeight: 64 }),
    ).toBe(60);
    expect(
      pixelsToMinutes({ pointerY: 50, columnTop: 100, hourHeight: 64 }),
    ).toBe(0);
    expect(
      pixelsToMinutes({ pointerY: 5000, columnTop: 100, hourHeight: 64 }),
    ).toBe(1440);
  });
});

describe("findColumnIndex", () => {
  const bounds = [
    { left: 0, right: 100 },
    { left: 100, right: 200 },
    { left: 200, right: 300 },
  ];

  it("finds the column under the pointer and clamps outside it", () => {
    expect(findColumnIndex(150, bounds)).toBe(1);
    expect(findColumnIndex(100, bounds)).toBe(1);
    expect(findColumnIndex(-20, bounds)).toBe(0);
    expect(findColumnIndex(999, bounds)).toBe(2);
    expect(findColumnIndex(10, [])).toBe(-1);
  });
});

describe("computeCreateRange", () => {
  it("covers the dragged area on the grid, in either direction", () => {
    const forward = computeCreateRange({
      dateKey: "2026-10-05",
      anchorMinutes: 9 * 60 + 10,
      currentMinutes: 10 * 60 + 20,
      timeZone: ROME,
    });
    const backward = computeCreateRange({
      dateKey: "2026-10-05",
      anchorMinutes: 10 * 60 + 20,
      currentMinutes: 9 * 60 + 10,
      timeZone: ROME,
    });

    expect(iso(forward.start)).toBe("2026-10-05T07:00:00.000Z");
    expect(iso(forward.end)).toBe("2026-10-05T08:30:00.000Z");
    expect(backward).toEqual(forward);
  });

  it("never returns less than one step", () => {
    const range = computeCreateRange({
      dateKey: "2026-10-05",
      anchorMinutes: 600,
      currentMinutes: 600,
      timeZone: ROME,
    });

    expect(iso(range.start)).toBe("2026-10-05T08:00:00.000Z");
    expect(iso(range.end)).toBe("2026-10-05T08:15:00.000Z");
  });

  it("ends at the next midnight when dragged to the bottom of the day", () => {
    const range = computeCreateRange({
      dateKey: "2026-10-05",
      anchorMinutes: 1430,
      currentMinutes: 1440,
      timeZone: ROME,
    });

    expect(iso(range.start)).toBe("2026-10-05T21:45:00.000Z");
    expect(iso(range.end)).toBe("2026-10-05T22:00:00.000Z");
  });

  it("uses wall-clock minutes on a spring-forward day", () => {
    // 2026-03-29: clocks jump from 02:00 to 03:00 in Rome.
    const range = computeCreateRange({
      dateKey: "2026-03-29",
      anchorMinutes: 90,
      currentMinutes: 210,
      timeZone: ROME,
    });

    expect(iso(range.start)).toBe("2026-03-29T00:30:00.000Z");
    expect(iso(range.end)).toBe("2026-03-29T01:30:00.000Z");
  });
});

describe("computeClickSlot", () => {
  it("starts at the clicked quarter hour and lasts an hour", () => {
    const slot = computeClickSlot({
      dateKey: "2026-10-05",
      minutes: 9 * 60 + 40,
      timeZone: ROME,
    });

    expect(iso(slot.start)).toBe("2026-10-05T07:30:00.000Z");
    expect(iso(slot.end)).toBe("2026-10-05T08:30:00.000Z");
  });
});

describe("minutesToInstant", () => {
  it("rolls minutes past midnight into the next day", () => {
    expect(iso(minutesToInstant("2026-10-05", 1500, ROME))).toBe(
      "2026-10-05T23:00:00.000Z",
    );
    expect(iso(minutesToInstant("2026-10-05", -60, ROME))).toBe(
      "2026-10-04T21:00:00.000Z",
    );
  });
});

describe("moveTimedEvent", () => {
  const start = new Date("2026-10-05T07:00:00Z"); // 09:00 Rome
  const end = new Date("2026-10-05T08:00:00Z");

  it("snaps the new start and keeps the length", () => {
    const moved = moveTimedEvent({
      start,
      end,
      timeZone: ROME,
      deltaMinutes: 95,
    });

    expect(iso(moved.start)).toBe("2026-10-05T08:30:00.000Z"); // 10:30 Rome
    expect(iso(moved.end)).toBe("2026-10-05T09:30:00.000Z");
  });

  it("moves across midnight in both directions", () => {
    const earlier = moveTimedEvent({
      start,
      end,
      timeZone: ROME,
      deltaMinutes: -600,
    });
    const later = moveTimedEvent({
      start,
      end,
      timeZone: ROME,
      deltaMinutes: 1440 + 60,
    });

    expect(iso(earlier.start)).toBe("2026-10-04T21:00:00.000Z"); // 23:00 Rome
    expect(iso(later.start)).toBe("2026-10-06T08:00:00.000Z"); // next day 10:00
  });

  it("leaves an off-grid event alone when it has not moved", () => {
    const offGrid = new Date("2026-10-05T07:05:00Z");
    expect(
      moveTimedEvent({ start: offGrid, end, timeZone: ROME, deltaMinutes: 0 })
        .start,
    ).toBe(offGrid);
  });

  it("lands on the clock time pointed at after a spring-forward gap", () => {
    // 23:00 on the 28th, moved to 02:00 on the 29th, which does not exist.
    const moved = moveTimedEvent({
      start: new Date("2026-03-28T22:00:00Z"),
      end: new Date("2026-03-28T23:00:00Z"),
      timeZone: ROME,
      deltaMinutes: 180,
    });

    expect(iso(moved.start)).toBe("2026-03-29T01:00:00.000Z"); // 03:00 CEST
    expect(moved.end.getTime() - moved.start.getTime()).toBe(3_600_000);
  });

  it("keeps the elapsed length when moved to the autumn day with 25 hours", () => {
    const moved = moveTimedEvent({
      start: new Date("2026-10-24T20:00:00Z"), // 22:00 CEST
      end: new Date("2026-10-24T21:00:00Z"),
      timeZone: ROME,
      deltaMinutes: 1440,
    });

    expect(iso(moved.start)).toBe("2026-10-25T21:00:00.000Z"); // 22:00 CET
    expect(moved.end.getTime() - moved.start.getTime()).toBe(3_600_000);
  });
});

describe("resizeTimedEvent", () => {
  const start = new Date("2026-10-05T07:00:00Z");
  const end = new Date("2026-10-05T08:00:00Z");

  it("snaps the new end", () => {
    const resized = resizeTimedEvent({
      start,
      end,
      timeZone: ROME,
      deltaMinutes: 40,
    });

    expect(resized.start).toBe(start);
    expect(iso(resized.end)).toBe("2026-10-05T08:45:00.000Z");
  });

  it("never shrinks below one step", () => {
    const resized = resizeTimedEvent({
      start,
      end,
      timeZone: ROME,
      deltaMinutes: -240,
    });

    expect(iso(resized.end)).toBe("2026-10-05T07:15:00.000Z");
  });

  it("can extend past midnight", () => {
    const resized = resizeTimedEvent({
      start: new Date("2026-10-05T20:00:00Z"), // 22:00 Rome
      end: new Date("2026-10-05T21:00:00Z"),
      timeZone: ROME,
      deltaMinutes: 120,
    });

    expect(iso(resized.end)).toBe("2026-10-05T23:00:00.000Z"); // 01:00 next day
  });

  it("measures the end on the wall clock across a DST change", () => {
    // 00:30-01:30 on 2026-03-29; +90 minutes of wall time ends at 03:00 CEST.
    const resized = resizeTimedEvent({
      start: new Date("2026-03-28T23:30:00Z"),
      end: new Date("2026-03-29T00:30:00Z"),
      timeZone: ROME,
      deltaMinutes: 90,
    });

    expect(iso(resized.end)).toBe("2026-03-29T01:00:00.000Z");
  });

  it("is a no-op without movement", () => {
    expect(
      resizeTimedEvent({ start, end, timeZone: ROME, deltaMinutes: 0 }).end,
    ).toBe(end);
  });
});

describe("moveEventByDays", () => {
  it("keeps the clock time of a timed event across the autumn DST change", () => {
    const moved = moveEventByDays({
      event: {
        isAllDay: false,
        start: new Date("2026-10-24T07:00:00Z"), // 09:00 CEST
        end: new Date("2026-10-24T08:30:00Z"),
      },
      dayDelta: 2,
      timeZone: ROME,
    });

    expect(moved.isAllDay).toBe(false);
    if (moved.isAllDay) return;
    expect(iso(moved.start)).toBe("2026-10-26T08:00:00.000Z"); // 09:00 CET
    expect(moved.end.getTime() - moved.start.getTime()).toBe(5_400_000);
  });

  it("shifts an all-day event by whole days over a month end", () => {
    expect(
      moveEventByDays({
        event: {
          isAllDay: true,
          startDate: "2026-10-30",
          endDate: "2026-11-02",
        },
        dayDelta: 3,
        timeZone: ROME,
      }),
    ).toEqual({
      isAllDay: true,
      startDate: "2026-11-02",
      endDate: "2026-11-05",
    });
  });

  it("moves backwards", () => {
    expect(
      moveEventByDays({
        event: {
          isAllDay: true,
          startDate: "2026-03-01",
          endDate: "2026-03-02",
        },
        dayDelta: -1,
        timeZone: ROME,
      }),
    ).toEqual({
      isAllDay: true,
      startDate: "2026-02-28",
      endDate: "2026-03-01",
    });
  });
});
