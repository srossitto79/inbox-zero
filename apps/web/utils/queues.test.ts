import { describe, expect, it } from "vitest";
import { ActionType } from "@/generated/prisma/enums";
import { buildQueuesFromRules, LEGACY_QUEUES, type MailQueue } from "./queues";

const labelAction = (label: string) => ({
  type: ActionType.LABEL,
  label,
});

const rule = (
  overrides: Partial<Parameters<typeof buildQueuesFromRules>[0][number]>,
) => ({
  id: "rule_1",
  showInQueuesSidebar: true,
  actions: [labelAction("Newsletter")],
  ...overrides,
});

describe("buildQueuesFromRules", () => {
  it("derives a queue from a rule that opted in", () => {
    const queues = buildQueuesFromRules([
      rule({ id: "rule_a", actions: [labelAction("Newsletters")] }),
    ]);

    expect(queues).toEqual([
      {
        id: "rule_a",
        name: "Newsletters",
        labelNames: ["newsletters"],
        colorVar: "queue-newsletter",
      },
    ]);
  });

  it("skips rules that never opted in", () => {
    expect(
      buildQueuesFromRules([rule({ showInQueuesSidebar: false })]),
    ).toEqual([]);
  });

  it("skips opted-in rules that apply no label", () => {
    expect(
      buildQueuesFromRules([rule({ actions: [{ type: ActionType.ARCHIVE }] })]),
    ).toEqual([]);
    expect(buildQueuesFromRules([rule({ actions: [] })])).toEqual([]);
  });

  it("claims every label a rule applies, deduplicated across rules", () => {
    const queues = buildQueuesFromRules([
      rule({
        id: "rule_a",
        actions: [labelAction("To Reply"), labelAction("Waiting")],
      }),
      rule({
        id: "rule_b",
        actions: [labelAction("To Reply"), labelAction("FYI")],
      }),
    ]);

    expect(queues).toEqual([
      {
        id: "rule_a",
        name: "To Reply",
        labelNames: ["to reply", "waiting"],
        colorVar: "queue-reply",
      },
      // rule_b lost "To Reply" to rule_a but keeps its unclaimed label.
      {
        id: "rule_b",
        name: "FYI",
        labelNames: ["fyi"],
        colorVar: "queue-fyi",
      },
    ]);
  });

  it("keeps the legacy queue order no matter where rules sort", () => {
    const queues = buildQueuesFromRules([
      rule({ id: "rule_c", actions: [labelAction("Calendar")] }),
      rule({ id: "rule_a", actions: [labelAction("To Reply")] }),
      rule({ id: "rule_f", actions: [labelAction("Custom")] }),
    ]);

    expect(queues.map((queue) => queue.name)).toEqual([
      "To Reply",
      "Calendar",
      "Custom",
    ]);
  });

  it("gives labels outside the legacy set a stable color", () => {
    const derive = (): MailQueue =>
      buildQueuesFromRules([
        rule({ id: "rule_x", actions: [labelAction("Receipts from work")] }),
      ])[0] as MailQueue;

    expect(derive().colorVar).toBe(derive().colorVar);
    expect(derive().colorVar.startsWith("queue-")).toBe(true);
  });

  it("colors by label rather than by rule type", () => {
    // A system rule keeps the legacy color of the label it applies, even
    // though nothing in the queue knows its SystemType anymore.
    expect(
      buildQueuesFromRules([
        rule({ id: "rule_a", actions: [labelAction("Awaiting Reply")] }),
      ])[0]?.colorVar,
    ).toBe("queue-waiting");
    expect(
      buildQueuesFromRules([
        rule({ id: "rule_b", actions: [labelAction("Newsletter")] }),
      ])[0]?.colorVar,
    ).toBe("queue-newsletter");
  });
});

describe("LEGACY_QUEUES", () => {
  it("matches the labels and order the sidebar showed before rules drove it", () => {
    expect(LEGACY_QUEUES.map((queue) => queue.labelNames[0])).toEqual([
      "to reply",
      "awaiting reply",
      "fyi",
      "newsletter",
      "receipt",
      "calendar",
    ]);
  });
});
