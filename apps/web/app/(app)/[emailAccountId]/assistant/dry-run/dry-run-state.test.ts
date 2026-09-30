import { describe, expect, it } from "vitest";
import {
  type DryRunEntry,
  hasRuleConditions,
  pickRecentThreads,
  summarizeDryRun,
} from "@/app/(app)/[emailAccountId]/assistant/dry-run/dry-run-state";

describe("pickRecentThreads", () => {
  it("keeps the newest message per thread and respects the limit", () => {
    const threads = pickRecentThreads(
      [
        message("m1", "t1"),
        message("m2", "t1"),
        message("m3", "t2"),
        message("m4", "t3"),
      ],
      2,
    );

    expect(threads.map((thread) => thread.messageId)).toEqual(["m1", "m3"]);
  });
});

describe("summarizeDryRun", () => {
  it("splits matches, left alone, pending and failed threads", () => {
    const threads = pickRecentThreads(
      [
        message("m1", "t1"),
        message("m2", "t2"),
        message("m3", "t3"),
        message("m4", "t4"),
      ],
      10,
    );
    const entries: Record<string, DryRunEntry> = {
      m1: {
        status: "done",
        outcome: { matched: true, method: "static", reason: "Matches" },
      },
      m2: {
        status: "done",
        outcome: { matched: false, method: "ai", reason: "Personal" },
      },
      m3: { status: "error", message: "boom" },
    };

    const summary = summarizeDryRun(threads, entries);

    expect(summary.matched.map((thread) => thread.messageId)).toEqual(["m1"]);
    expect(summary.leftAlone).toHaveLength(1);
    expect(summary.leftAlone[0].reason).toBe("Personal");
    expect(summary.failed).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.checked).toBe(2);
  });
});

describe("hasRuleConditions", () => {
  it("ignores blank conditions", () => {
    expect(hasRuleConditions([{ instructions: "  ", from: "" }])).toBe(false);
    expect(hasRuleConditions([{ subject: "Invoice" }])).toBe(true);
  });
});

function message(id: string, threadId: string) {
  return { id, threadId, headers: { from: "a@example.com", subject: id } };
}
