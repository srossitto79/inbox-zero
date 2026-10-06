import { describe, expect, it } from "vitest";
import { LEGACY_QUEUES } from "@/utils/queues";
import {
  type QueueId,
  buildQueueLabelLookup,
  countThreadsByQueue,
  getQueueName,
  getThreadQueueId,
  orderThreadsByQueue,
  readCollapsedQueueLabels,
  readQueueViewMode,
  writeCollapsedQueueLabels,
  writeQueueViewMode,
} from "./queue-grouping";

const labels = {
  a: { id: "a", name: "To Reply" },
  b: { id: "b", name: "Awaiting Reply" },
  c: { id: "c", name: "Newsletter" },
  d: { id: "d", name: "Personal" },
};
const lookup = buildQueueLabelLookup(LEGACY_QUEUES, labels);

describe("getThreadQueueId", () => {
  it("matches label names case-insensitively", () => {
    expect(getThreadQueueId([{ labelIds: ["b"] }], lookup, LEGACY_QUEUES)).toBe(
      "waiting",
    );
  });

  it("prefers the earlier queue when several apply", () => {
    expect(
      getThreadQueueId(
        [{ labelIds: ["c"] }, { labelIds: ["a"] }],
        lookup,
        LEGACY_QUEUES,
      ),
    ).toBe("reply");
  });

  it("returns null without a queue label", () => {
    expect(
      getThreadQueueId([{ labelIds: ["d"] }, {}], lookup, LEGACY_QUEUES),
    ).toBeNull();
  });
});

describe("orderThreadsByQueue", () => {
  it("orders by queue, keeps order within a queue, puts the rest last", () => {
    const threads: { id: number; q: QueueId | null }[] = [
      { id: 1, q: null },
      { id: 2, q: "newsletter" },
      { id: 3, q: "reply" },
      { id: 4, q: "newsletter" },
      { id: 5, q: "reply" },
    ];
    const ordered = orderThreadsByQueue(threads, (t) => t.q, LEGACY_QUEUES);
    expect(ordered.map((t) => t.id)).toEqual([3, 5, 2, 4, 1]);
  });
});

describe("countThreadsByQueue", () => {
  it("counts per queue with null for the rest", () => {
    const counts = countThreadsByQueue<QueueId | null>(
      ["reply", null, "reply"],
      (q) => q,
    );
    expect(counts.get("reply")).toBe(2);
    expect(counts.get(null)).toBe(1);
  });
});

describe("getQueueName", () => {
  it("names the fallback group", () => {
    expect(getQueueName(LEGACY_QUEUES, null)).toBe("Everything else");
    expect(getQueueName(LEGACY_QUEUES, "waiting")).toBe("Awaiting Reply");
    expect(getQueueName(LEGACY_QUEUES, "no-such-queue")).toBe(
      "Everything else",
    );
  });
});

describe("view mode storage", () => {
  it("defaults to queues and reads back a stored timeline choice", () => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    } as Storage;
    expect(readQueueViewMode()).toBe("queues");
    writeQueueViewMode("timeline");
    expect(readQueueViewMode()).toBe("timeline");
  });
});

describe("collapsed queue storage", () => {
  it("round-trips the set of hidden queue labels", () => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    } as Storage;

    expect(readCollapsedQueueLabels()).toEqual(new Set());
    writeCollapsedQueueLabels(new Set(["Newsletters", "Receipts"]));
    expect(readCollapsedQueueLabels()).toEqual(
      new Set(["Newsletters", "Receipts"]),
    );
  });

  it("ignores corrupt storage instead of throwing", () => {
    globalThis.localStorage = {
      getItem: (key: string): string | null =>
        key === "mail-collapsed-queues" ? '"not an array"' : null,
      setItem: (_key: string, _value: string) => {},
    } as Storage;

    expect(readCollapsedQueueLabels()).toEqual(new Set());
  });
});
