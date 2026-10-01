import { describe, expect, it } from "vitest";
import { findFreeSlots, type BusyInterval } from "./find-free-slots";

const schedule = {
  workingDays: [1, 2, 3, 4, 5],
  workingHours: { start: "09:00", end: "17:00" },
};

const base = {
  durationMinutes: 60,
  schedule,
  timeZone: "UTC",
  granularityMinutes: 30,
};

function busy(start: string, end: string): BusyInterval {
  return { start: new Date(start), end: new Date(end) };
}

function iso(slots: { start: Date; end: Date }[]) {
  return slots.map((slot) => slot.start.toISOString());
}

// 2026-10-05 is a Monday
const monday = {
  start: new Date("2026-10-05T00:00:00Z"),
  end: new Date("2026-10-06T00:00:00Z"),
};

describe("findFreeSlots", () => {
  it("offers the start of the working day when everyone is free", () => {
    const slots = findFreeSlots({
      ...base,
      busyByPerson: { me: [] },
      window: monday,
      limit: 3,
    });
    expect(iso(slots)).toEqual([
      "2026-10-05T09:00:00.000Z",
      "2026-10-05T10:00:00.000Z",
      "2026-10-05T11:00:00.000Z",
    ]);
  });

  it("avoids every person's busy time", () => {
    const slots = findFreeSlots({
      ...base,
      busyByPerson: {
        me: [busy("2026-10-05T09:00:00Z", "2026-10-05T12:00:00Z")],
        guest: [busy("2026-10-05T12:00:00Z", "2026-10-05T14:00:00Z")],
      },
      window: monday,
      limit: 1,
    });
    expect(iso(slots)).toEqual(["2026-10-05T14:30:00.000Z"]);
  });

  it("returns nothing when no gap fits the duration", () => {
    const slots = findFreeSlots({
      ...base,
      durationMinutes: 120,
      busyByPerson: {
        me: [
          busy("2026-10-05T10:00:00Z", "2026-10-05T11:00:00Z"),
          busy("2026-10-05T12:00:00Z", "2026-10-05T13:00:00Z"),
          busy("2026-10-05T14:00:00Z", "2026-10-05T15:00:00Z"),
          busy("2026-10-05T16:00:00Z", "2026-10-05T17:00:00Z"),
        ],
      },
      window: monday,
    });
    expect(slots).toEqual([]);
  });

  it("skips weekends and moves on to the next working day", () => {
    const slots = findFreeSlots({
      ...base,
      busyByPerson: { me: [] },
      window: {
        start: new Date("2026-10-03T00:00:00Z"), // Saturday
        end: new Date("2026-10-07T00:00:00Z"),
      },
      limit: 1,
    });
    expect(iso(slots)).toEqual(["2026-10-05T09:00:00.000Z"]);
  });

  it("clips to the window", () => {
    const slots = findFreeSlots({
      ...base,
      busyByPerson: { me: [] },
      window: {
        start: new Date("2026-10-05T13:10:00Z"),
        end: new Date("2026-10-05T15:00:00Z"),
      },
    });
    expect(iso(slots)).toEqual(["2026-10-05T13:30:00.000Z"]);
  });

  it("treats an all-day event as busy for the whole local day", () => {
    const slots = findFreeSlots({
      ...base,
      busyByPerson: {
        me: [{ allDay: true, startDate: "2026-10-05", endDate: "2026-10-06" }],
      },
      window: {
        start: new Date("2026-10-05T00:00:00Z"),
        end: new Date("2026-10-07T00:00:00Z"),
      },
      limit: 1,
    });
    expect(iso(slots)).toEqual(["2026-10-06T09:00:00.000Z"]);
  });

  it("reads an all-day event in the search time zone", () => {
    const slots = findFreeSlots({
      ...base,
      timeZone: "Pacific/Auckland",
      // Auckland is UTC+13 in October: 09:00 local Monday is Sunday 20:00Z.
      busyByPerson: {
        me: [{ allDay: true, startDate: "2026-10-05", endDate: "2026-10-06" }],
      },
      window: {
        start: new Date("2026-10-04T00:00:00Z"),
        end: new Date("2026-10-06T12:00:00Z"),
      },
      limit: 1,
    });
    expect(iso(slots)).toEqual(["2026-10-05T20:00:00.000Z"]);
  });

  it("ranks fewer back-to-back neighbours first within a day", () => {
    const slots = findFreeSlots({
      ...base,
      busyByPerson: {
        me: [busy("2026-10-05T09:00:00Z", "2026-10-05T10:00:00Z")],
      },
      window: monday,
      limit: 2,
    });
    // 10:00 touches the 09:00-10:00 meeting; 10:30 does not.
    expect(slots[0].start.toISOString()).toBe("2026-10-05T10:30:00.000Z");
    expect(slots[0].backToBack).toBe(0);
    expect(slots[1].start.toISOString()).toBe("2026-10-05T11:30:00.000Z");
  });

  it("returns distinct, non-overlapping options", () => {
    const slots = findFreeSlots({
      ...base,
      busyByPerson: { me: [] },
      window: monday,
      limit: 20,
    });
    for (let index = 1; index < slots.length; index++) {
      expect(slots[index].start.getTime()).toBeGreaterThanOrEqual(
        Math.min(...slots.slice(0, index).map((slot) => slot.end.getTime())),
      );
    }
    expect(slots).toHaveLength(8);
  });

  it("handles the autumn DST change in the search zone", () => {
    // Europe/Rome leaves DST on Sunday 2026-10-25: Monday is UTC+1.
    const slots = findFreeSlots({
      ...base,
      timeZone: "Europe/Rome",
      busyByPerson: { me: [] },
      window: {
        start: new Date("2026-10-23T00:00:00Z"), // Friday, still UTC+2
        end: new Date("2026-10-27T00:00:00Z"),
      },
      limit: 1,
    });
    expect(iso(slots)).toEqual(["2026-10-23T07:00:00.000Z"]);

    const monday26 = findFreeSlots({
      ...base,
      timeZone: "Europe/Rome",
      busyByPerson: { me: [] },
      window: {
        start: new Date("2026-10-26T00:00:00Z"),
        end: new Date("2026-10-27T00:00:00Z"),
      },
      limit: 1,
    });
    expect(iso(monday26)).toEqual(["2026-10-26T08:00:00.000Z"]);
  });

  it("handles the spring DST change in the search zone", () => {
    // America/New_York starts DST on Sunday 2026-03-08.
    const slots = findFreeSlots({
      ...base,
      timeZone: "America/New_York",
      busyByPerson: { me: [] },
      window: {
        start: new Date("2026-03-06T00:00:00Z"), // Friday, UTC-5
        end: new Date("2026-03-10T00:00:00Z"),
      },
      limit: 10,
    });
    const first = slots.find((slot) => slot.start.getUTCDate() === 6);
    expect(first?.start.toISOString()).toBe("2026-03-06T14:00:00.000Z");
    const afterChange = slots.find((slot) => slot.start.getUTCDate() === 9);
    expect(afterChange?.start.toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });

  it("ranks slots outside a participant's working hours below others", () => {
    const slots = findFreeSlots({
      ...base,
      busyByPerson: { me: [], guest: [] },
      participantTimeZones: { guest: "America/New_York" },
      window: monday,
      limit: 8,
    });
    // 09:00 UTC is 05:00 in New York (EDT); first shared hour is 13:00 UTC.
    expect(slots[0].start.toISOString()).toBe("2026-10-05T13:00:00.000Z");
    expect(slots[0].outsideWorkingHours).toEqual([]);
    expect(
      slots.some((slot) => slot.outsideWorkingHours.includes("guest")),
    ).toBe(true);
  });

  it("can search outside working hours, ranked after working hours", () => {
    const slots = findFreeSlots({
      ...base,
      busyByPerson: {
        me: [busy("2026-10-05T09:00:00Z", "2026-10-05T17:00:00Z")],
      },
      window: monday,
      includeOutsideWorkingHours: true,
      limit: 2,
    });
    expect(slots).toHaveLength(2);
    expect(slots[0].start.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("ignores zero-length busy periods and rejects bad input", () => {
    expect(
      findFreeSlots({
        ...base,
        busyByPerson: {
          me: [busy("2026-10-05T10:00:00Z", "2026-10-05T10:00:00Z")],
        },
        window: monday,
        limit: 1,
      })[0].start.toISOString(),
    ).toBe("2026-10-05T09:00:00.000Z");
    expect(
      findFreeSlots({
        ...base,
        durationMinutes: 0,
        busyByPerson: { me: [] },
        window: monday,
      }),
    ).toEqual([]);
    expect(
      findFreeSlots({
        ...base,
        busyByPerson: { me: [] },
        window: { start: monday.end, end: monday.start },
      }),
    ).toEqual([]);
  });
});
