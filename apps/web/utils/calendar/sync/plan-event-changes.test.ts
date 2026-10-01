import { describe, expect, it } from "vitest";
import { planEventChanges } from "./plan-event-changes";
import type { EventRowData, SyncItem } from "./types";

function upsert(
  providerEventId: string,
  overrides: Partial<EventRowData> = {},
): SyncItem {
  return {
    kind: "upsert",
    data: {
      providerEventId,
      title: providerEventId,
      startTime: new Date("2026-10-05T07:00:00Z"),
      endTime: new Date("2026-10-05T08:00:00Z"),
      recurrence: [],
      ...overrides,
    },
  };
}

function remove(providerEventId: string, withInstances = false): SyncItem {
  return { kind: "remove", providerEventId, withInstances };
}

describe("planEventChanges", () => {
  it("keeps only the last mention of an event", () => {
    const plan = planEventChanges([
      upsert("a", { title: "first" }),
      upsert("a", { title: "second" }),
      upsert("b"),
      remove("b"),
    ]);

    expect(plan.upserts.map((row) => row.title)).toEqual(["second"]);
    expect(plan.removedIds).toEqual(["b"]);
  });

  it("restores an event that was removed and then modified again", () => {
    const plan = planEventChanges([remove("a"), upsert("a")]);

    expect(plan.removedIds).toEqual([]);
    expect(plan.upserts).toHaveLength(1);
  });

  it("drops the exceptions of a cancelled series", () => {
    const plan = planEventChanges([
      remove("series", true),
      upsert("series_1", { recurringEventId: "series" }),
      upsert("other"),
    ]);

    expect(plan.removedSeriesIds).toEqual(["series"]);
    expect(plan.upserts.map((row) => row.providerEventId)).toEqual(["other"]);
  });

  it("keeps a cancelled instance as a tombstone upsert", () => {
    const plan = planEventChanges([
      upsert("series_1", {
        recurringEventId: "series",
        status: "CANCELLED",
      }),
    ]);

    expect(plan.upserts[0]).toMatchObject({ status: "CANCELLED" });
    expect(plan.removedIds).toEqual([]);
  });
});
