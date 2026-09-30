import { describe, expect, it } from "vitest";
import {
  type QueueId,
  buildQueueLabelLookup,
  countThreadsByQueue,
  getQueueName,
  getThreadQueueId,
  orderThreadsByQueue,
  readQueueViewMode,
  writeQueueViewMode,
} from "./queue-grouping";

const labels = {
  a: { id: "a", name: "To Reply" },
  b: { id: "b", name: "Awaiting Reply" },
  c: { id: "c", name: "Newsletter" },
  d: { id: "d", name: "Personal" },
};
const lookup = buildQueueLabelLookup(labels);

describe("getThreadQueueId", () => {
  it("matches label names case-insensitively", () => {
    expect(getThreadQueueId([{ labelIds: ["b"] }], lookup)).toBe("waiting");
  });

  it("prefers the earlier queue when several apply", () => {
    expect(
      getThreadQueueId([{ labelIds: ["c"] }, { labelIds: ["a"] }], lookup),
    ).toBe("reply");
  });

  it("returns null without a queue label", () => {
    expect(getThreadQueueId([{ labelIds: ["d"] }, {}], lookup)).toBeNull();
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
    const ordered = orderThreadsByQueue(threads, (t) => t.q);
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
    expect(getQueueName(null)).toBe("Everything else");
    expect(getQueueName("waiting")).toBe("Waiting on others");
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
