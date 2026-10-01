import { describe, expect, it } from "vitest";
import {
  getDaySegment,
  getEventDateKeys,
  getRangeInstants,
  getVisibleDateKeys,
  groupEventsByDay,
  shiftAnchor,
} from "./event-range";

const ROME = "Europe/Rome";

describe("getVisibleDateKeys", () => {
  it("starts a week on the configured day", () => {
    // 2026-10-01 is a Thursday.
    expect(
      getVisibleDateKeys({
        view: "week",
        anchorKey: "2026-10-01",
        weekStart: "monday",
      })[0],
    ).toBe("2026-09-28");
    expect(
      getVisibleDateKeys({
        view: "week",
        anchorKey: "2026-10-01",
        weekStart: "sunday",
      })[0],
    ).toBe("2026-09-27");
    expect(
      getVisibleDateKeys({
        view: "week",
        anchorKey: "2026-10-01",
        weekStart: "saturday",
      })[0],
    ).toBe("2026-09-26");
  });

  it("sizes the month grid to whole weeks the month needs", () => {
    // February 2026 starts on a Sunday: four Monday-based weeks plus the first day.
    const february = getVisibleDateKeys({
      view: "month",
      anchorKey: "2026-02-10",
      weekStart: "monday",
    });
    expect(february).toHaveLength(35);
    expect(february[0]).toBe("2026-01-26");

    // August 2026 starts on a Saturday and spans six Monday-based weeks.
    const august = getVisibleDateKeys({
      view: "month",
      anchorKey: "2026-08-15",
      weekStart: "monday",
    });
    expect(august).toHaveLength(42);
    expect(august[0]).toBe("2026-07-27");

    // A Saturday month opens one day earlier under a Sunday start, and still
    // needs six whole weeks.
    const augustSunday = getVisibleDateKeys({
      view: "month",
      anchorKey: "2026-08-15",
      weekStart: "sunday",
    });
    expect(augustSunday[0]).toBe("2026-07-26");
    expect(augustSunday).toHaveLength(42);
  });

  it("returns a single day for the day view", () => {
    expect(
      getVisibleDateKeys({
        view: "day",
        anchorKey: "2026-10-01",
        weekStart: "monday",
      }),
    ).toEqual(["2026-10-01"]);
  });
});

describe("shiftAnchor", () => {
  it("moves a month at a time without skipping short months", () => {
    expect(
      shiftAnchor({ view: "month", anchorKey: "2026-01-31", direction: 1 }),
    ).toBe("2026-02-01");
    expect(
      shiftAnchor({ view: "month", anchorKey: "2026-01-15", direction: -1 }),
    ).toBe("2025-12-01");
  });

  it("moves a week and a day by their length", () => {
    expect(
      shiftAnchor({ view: "week", anchorKey: "2026-10-01", direction: 1 }),
    ).toBe("2026-10-08");
    expect(
      shiftAnchor({ view: "day", anchorKey: "2026-03-01", direction: -1 }),
    ).toBe("2026-02-28");
  });
});

describe("getRangeInstants", () => {
  it("spans a DST week by local midnights, not by 7 x 24 hours", () => {
    // Rome switches to summer time on 2026-03-29, so the week is 167 hours.
    const keys = getVisibleDateKeys({
      view: "week",
      anchorKey: "2026-03-26",
      weekStart: "monday",
    });
    const { from, to } = getRangeInstants(keys, ROME);

    expect(from.toISOString()).toBe("2026-03-22T23:00:00.000Z");
    expect(to.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });
});

describe("getEventDateKeys", () => {
  it("lists every day of a multi-day all-day event", () => {
    expect(
      getEventDateKeys(
        { id: "a", isAllDay: true, start: "2026-10-01", end: "2026-10-04" },
        ROME,
      ),
    ).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("places a timed event on the local day, not the UTC day", () => {
    // 23:30 in Rome on the 1st is 21:30 UTC; 00:30 on the 2nd is 22:30 UTC.
    expect(
      getEventDateKeys(
        {
          id: "a",
          isAllDay: false,
          start: "2026-10-01T21:30:00.000Z",
          end: "2026-10-01T22:30:00.000Z",
        },
        ROME,
      ),
    ).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("does not spill into the next day when an event ends at midnight", () => {
    expect(
      getEventDateKeys(
        {
          id: "a",
          isAllDay: false,
          start: "2026-10-01T20:00:00.000Z",
          end: "2026-10-01T22:00:00.000Z",
        },
        ROME,
      ),
    ).toEqual(["2026-10-01"]);
  });

  it("keeps a zero-length event on its day", () => {
    expect(
      getEventDateKeys(
        {
          id: "a",
          isAllDay: false,
          start: "2026-10-01T10:00:00.000Z",
          end: "2026-10-01T10:00:00.000Z",
        },
        ROME,
      ),
    ).toEqual(["2026-10-01"]);
  });
});

describe("getDaySegment", () => {
  const overnight = {
    id: "a",
    isAllDay: false,
    start: "2026-10-01T20:00:00.000Z", // 22:00 Rome
    end: "2026-10-02T06:30:00.000Z", // 08:30 Rome
  };

  it("clips an overnight event to each day", () => {
    expect(getDaySegment(overnight, "2026-10-01", ROME)).toEqual({
      start: 22 * 60,
      end: 24 * 60,
    });
    expect(getDaySegment(overnight, "2026-10-02", ROME)).toEqual({
      start: 0,
      end: 8 * 60 + 30,
    });
  });

  it("uses wall-clock minutes on a spring-forward day", () => {
    // 09:00 Rome on 2026-03-29 is 07:00 UTC, five hours after local midnight in
    // elapsed time but nine hours by the clock.
    expect(
      getDaySegment(
        {
          id: "a",
          isAllDay: false,
          start: "2026-03-29T07:00:00.000Z",
          end: "2026-03-29T08:00:00.000Z",
        },
        "2026-03-29",
        ROME,
      ),
    ).toEqual({ start: 9 * 60, end: 10 * 60 });
  });
});

describe("groupEventsByDay", () => {
  it("puts all-day events before timed ones and repeats multi-day events", () => {
    const timed = {
      id: "timed",
      isAllDay: false,
      start: "2026-10-01T08:00:00.000Z",
      end: "2026-10-01T09:00:00.000Z",
    };
    const trip = {
      id: "trip",
      isAllDay: true,
      start: "2026-10-01",
      end: "2026-10-03",
    };

    const grouped = groupEventsByDay(
      [timed, trip],
      ["2026-10-01", "2026-10-02", "2026-10-03"],
      ROME,
    );

    expect(grouped.get("2026-10-01")?.map((event) => event.id)).toEqual([
      "trip",
      "timed",
    ]);
    expect(grouped.get("2026-10-02")?.map((event) => event.id)).toEqual([
      "trip",
    ]);
    expect(grouped.get("2026-10-03")).toEqual([]);
  });
});
