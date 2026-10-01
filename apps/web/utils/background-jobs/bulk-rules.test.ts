import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createScopedLogger } from "@/utils/logger";
import { createEmailProvider } from "@/utils/email/provider";
import {
  gmailMailSyncCosts,
  LocalMailSyncPausedError,
  withLocalMailSyncBudget,
} from "@/utils/email/local-mail-sync-budget";
import { getEmailAccountForRuleExecution } from "@/utils/user/get";
import { loadThreads } from "@/utils/threads/load";
import { sleep } from "@/utils/sleep";
import { runRules } from "@/utils/ai/choose-rule/run-rules";
import { runBulkRulesChunk } from "@/utils/background-jobs/bulk-rules";
import type { BulkRulesPayload } from "@/utils/background-jobs/bulk-rules.schema";

vi.mock("@/utils/prisma");
vi.mock("server-only", () => ({}));
vi.mock("@/utils/email/provider", () => ({ createEmailProvider: vi.fn() }));
vi.mock("@/utils/user/get", () => ({
  getEmailAccountForRuleExecution: vi.fn(),
}));
vi.mock("@/utils/threads/load", () => ({ loadThreads: vi.fn() }));
vi.mock("@/utils/sleep", () => ({ sleep: vi.fn() }));
vi.mock("@/utils/ai/choose-rule/run-rules", () => ({ runRules: vi.fn() }));
vi.mock("@/utils/email/local-mail-sync-budget", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/utils/email/local-mail-sync-budget")
  >()),
  withLocalMailSyncBudget: vi.fn(),
}));

const logger = createScopedLogger("bulk-rules-test");
const getMessage = vi.fn();

describe("runBulkRulesChunk", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getMessage.mockImplementation(async (id: string) => ({
      id,
      headers: { from: "a@example.com", subject: "Hello" },
    }));
    vi.mocked(getEmailAccountForRuleExecution).mockResolvedValue({
      id: "account-1",
      account: { provider: "google" },
    } as never);
    vi.mocked(createEmailProvider).mockResolvedValue({
      name: "google",
      getMessage,
    } as never);
    vi.mocked(withLocalMailSyncBudget).mockImplementation((_input, operation) =>
      operation(new AbortController().signal),
    );
    prisma.rule.findMany.mockResolvedValue([]);
    vi.mocked(runRules).mockResolvedValue([]);
  });

  it("lists the page through the backfill budget and returns the next cursor", async () => {
    mockPage([thread("t1"), thread("t2")], "next-page");

    const chunk = await runChunk();

    expect(withLocalMailSyncBudget).toHaveBeenCalledWith(
      {
        emailAccountId: "account-1",
        provider: "google",
        priority: "backfill",
        cost: gmailMailSyncCosts.list + 25 * gmailMailSyncCosts.message,
      },
      expect.any(Function),
    );
    expect(chunk).toMatchObject({
      finished: false,
      progressDone: 2,
      payload: { nextPageToken: "next-page", pageProcessedThreadIds: [] },
    });
    expect(runRules).toHaveBeenCalledTimes(2);
  });

  it("charges each message read to the budget", async () => {
    mockPage([thread("t1")]);

    await runChunk();

    expect(withLocalMailSyncBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: "backfill",
        cost: gmailMailSyncCosts.message,
      }),
      expect.any(Function),
    );
  });

  it("finishes when there is no further page", async () => {
    mockPage([thread("t1")]);

    const chunk = await runChunk();

    expect(chunk).toMatchObject({
      finished: true,
      progressDone: 1,
      progressTotal: 1,
    });
  });

  it("lists the date range and unread mail only by default", async () => {
    mockPage([]);

    await runChunk({
      startDate: "2026-03-01T00:00:00.000Z",
      before: "2026-03-02T00:00:00.000Z",
    });

    const { query } = vi.mocked(loadThreads).mock.calls[0][0];
    expect(query.after).toEqual(new Date("2026-03-01T00:00:00.000Z"));
    expect(query.before).toEqual(new Date("2026-03-02T00:00:00.000Z"));
    expect(query.isUnread).toBe(true);
  });

  it("lists read mail too when asked", async () => {
    mockPage([]);

    await runChunk({ includeRead: true });

    expect(vi.mocked(loadThreads).mock.calls[0][0].query.isUnread).toBe(
      undefined,
    );
  });

  it("skips threads that already have a plan unless rerunning", async () => {
    mockPage([thread("done", { plan: {} }), thread("new")]);

    await runChunk();
    expect(runRules).toHaveBeenCalledTimes(1);

    vi.mocked(runRules).mockClear();
    mockPage([thread("done", { plan: {} }), thread("new")]);

    await runChunk({ rerun: true });
    expect(runRules).toHaveBeenCalledTimes(2);
  });

  it("stops at the email limit, also when rerunning", async () => {
    mockPage([thread("t1"), thread("t2"), thread("t3")], "more");

    const chunk = await runChunk({ rerun: true, maxEmails: 2 });

    expect(runRules).toHaveBeenCalledTimes(2);
    expect(chunk).toMatchObject({ finished: true, progressDone: 2 });
  });

  it("does not rerun threads of the current page that already ran after a pause", async () => {
    mockPage([thread("t1"), thread("t2")]);

    await runChunk({ rerun: true, pageProcessedThreadIds: ["t1"] });

    expect(getMessage).toHaveBeenCalledTimes(1);
    expect(getMessage).toHaveBeenCalledWith("t2-message");
  });

  it("saves its progress and asks to pause when the budget runs out mid page", async () => {
    mockPage([thread("t1"), thread("t2"), thread("t3"), thread("t4")]);
    vi.mocked(withLocalMailSyncBudget).mockImplementation(
      async (input, operation) => {
        // Call 1 lists the page; calls 2 to 4 read t1 to t3; call 5 reads t4.
        const callNumber = vi.mocked(withLocalMailSyncBudget).mock.calls.length;
        if (callNumber === 5) throw new LocalMailSyncPausedError(30_000);
        return operation(new AbortController().signal);
      },
    );

    const chunk = await runChunk();

    expect(chunk.finished).toBe(false);
    expect(chunk.pauseMs).toBe(30_000);
    expect(chunk.progressDone).toBe(3);
    expect(chunk.payload).toMatchObject({
      pageProcessedThreadIds: ["t1", "t2", "t3"],
    });
  });

  it("lets the executor pause when the page listing is refused", async () => {
    vi.mocked(loadThreads).mockRejectedValue(
      new LocalMailSyncPausedError(20_000),
    );

    await expect(runChunk()).rejects.toBeInstanceOf(LocalMailSyncPausedError);
  });

  it("stops at the next checkpoint once cancellation was requested", async () => {
    mockPage([thread("t1"), thread("t2"), thread("t3"), thread("t4")], "more");
    const checkpoint = vi.fn().mockResolvedValue(true);

    const chunk = await runChunk({}, { checkpoint });

    expect(runRules).toHaveBeenCalledTimes(3);
    expect(chunk.finished).toBe(false);
    expect(chunk.payload).toMatchObject({
      pageProcessedThreadIds: ["t1", "t2", "t3"],
    });
  });

  it("records matches and per-email failures without stopping the run", async () => {
    mockPage([thread("t1"), thread("t2")]);
    vi.mocked(runRules)
      .mockResolvedValueOnce([{ rule: { name: "Newsletter" } } as never])
      .mockRejectedValueOnce(new Error("LLM failed"));

    const chunk = await runChunk();

    expect(chunk.finished).toBe(true);
    expect(chunk.result).toMatchObject({
      processed: 2,
      matched: 1,
      failed: 1,
    });
  });

  it("reads messages one at a time and runs the rules in parallel", async () => {
    mockPage([thread("t1"), thread("t2"), thread("t3")]);
    let activeReads = 0;
    let maxReads = 0;
    vi.mocked(withLocalMailSyncBudget).mockImplementation(
      async (input, operation) => {
        if (input.cost !== gmailMailSyncCosts.message) {
          return operation(new AbortController().signal);
        }
        activeReads += 1;
        maxReads = Math.max(maxReads, activeReads);
        await Promise.resolve();
        try {
          return await operation(new AbortController().signal);
        } finally {
          activeReads -= 1;
        }
      },
    );
    let activeRules = 0;
    let maxRules = 0;
    vi.mocked(runRules).mockImplementation(async () => {
      activeRules += 1;
      maxRules = Math.max(maxRules, activeRules);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRules -= 1;
      return [];
    });

    const chunk = await runChunk();

    expect(chunk.progressDone).toBe(3);
    expect(maxReads).toBe(1);
    expect(maxRules).toBe(3);
  });

  describe("short budget denials", () => {
    it("waits and retries a short denial without pausing the job", async () => {
      mockPage([thread("t1")]);
      denyMessageReads(1, 1000);

      const chunk = await runChunk();

      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledWith(1000);
      expect(getMessage).toHaveBeenCalledTimes(1);
      expect(chunk.pauseMs).toBeUndefined();
      expect(chunk).toMatchObject({ finished: true, progressDone: 1 });
    });

    it("gives up after a bounded number of attempts and pauses", async () => {
      mockPage([thread("t1"), thread("t2")]);
      denyMessageReads(Number.POSITIVE_INFINITY, 1000);

      const chunk = await runChunk();

      const messageReads = vi
        .mocked(withLocalMailSyncBudget)
        .mock.calls.filter(
          ([input]) => input.cost === gmailMailSyncCosts.message,
        );
      expect(messageReads).toHaveLength(5);
      expect(sleep).toHaveBeenCalledTimes(4);
      expect(chunk).toMatchObject({ finished: false, pauseMs: 1000 });
      expect(chunk.progressDone).toBe(0);
      expect(runRules).not.toHaveBeenCalled();
    });

    it("pauses at once on a long denial", async () => {
      mockPage([thread("t1")]);
      denyMessageReads(Number.POSITIVE_INFINITY, 30_000);

      const chunk = await runChunk();

      expect(sleep).not.toHaveBeenCalled();
      expect(chunk).toMatchObject({ finished: false, pauseMs: 30_000 });
    });

    it("waits out a short denial of the page listing", async () => {
      let listings = 0;
      vi.mocked(withLocalMailSyncBudget).mockImplementation(
        async (input, operation) => {
          if (input.cost !== gmailMailSyncCosts.message && listings++ === 0) {
            throw new LocalMailSyncPausedError(1000);
          }
          return operation(new AbortController().signal);
        },
      );
      mockPage([thread("t1")]);

      const chunk = await runChunk();

      expect(sleep).toHaveBeenCalledWith(1000);
      expect(chunk.progressDone).toBe(1);
    });

    it("stops waiting when cancellation was requested during the wait", async () => {
      mockPage([thread("t1"), thread("t2")], "more");
      denyMessageReads(Number.POSITIVE_INFINITY, 1000);
      const checkpoint = vi.fn().mockResolvedValue(true);

      const chunk = await runChunk({}, { checkpoint });

      expect(sleep).toHaveBeenCalledTimes(1);
      expect(chunk.pauseMs).toBeUndefined();
      expect(chunk).toMatchObject({ finished: false, progressDone: 0 });
      expect(runRules).not.toHaveBeenCalled();
    });

    it("stops waiting when cancellation arrives while listing", async () => {
      vi.mocked(withLocalMailSyncBudget).mockRejectedValue(
        new LocalMailSyncPausedError(1000),
      );
      const checkpoint = vi.fn().mockResolvedValue(true);

      const chunk = await runChunk({}, { checkpoint });

      expect(chunk).toMatchObject({ finished: false, progressDone: 0 });
      expect(chunk.pauseMs).toBeUndefined();
      expect(loadThreads).not.toHaveBeenCalled();
    });
  });

  it("fails the job after several emails fail in a row", async () => {
    mockPage([
      thread("t1"),
      thread("t2"),
      thread("t3"),
      thread("t4"),
      thread("t5"),
      thread("t6"),
    ]);
    vi.mocked(runRules).mockRejectedValue(new Error("LLM failed"));

    const chunk = await runChunk();

    expect(chunk).toMatchObject({
      finished: true,
      failure: "LLM failed",
      progressDone: 6,
    });
  });

  it("ends as failed with the first error when no email succeeded", async () => {
    mockPage([thread("t1")]);
    vi.mocked(runRules).mockRejectedValue(new Error("after was called"));

    const chunk = await runChunk();

    expect(chunk).toMatchObject({
      finished: true,
      failure: "after was called",
    });
    expect(chunk.result).toMatchObject({ processed: 1, failed: 1, matched: 0 });
  });

  it("ends as succeeded when only some emails failed", async () => {
    mockPage([thread("t1"), thread("t2")]);
    vi.mocked(runRules)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("LLM failed"));

    const chunk = await runChunk();

    expect(chunk.finished).toBe(true);
    expect(chunk.failure).toBeUndefined();
  });
});

// Denies the first `times` message reads with the given retry delay.
function denyMessageReads(times: number, retryAfterMs: number) {
  let denied = 0;
  vi.mocked(withLocalMailSyncBudget).mockImplementation(
    async (input, operation) => {
      if (input.cost === gmailMailSyncCosts.message && denied < times) {
        denied += 1;
        throw new LocalMailSyncPausedError(retryAfterMs);
      }
      return operation(new AbortController().signal);
    },
  );
}

function thread(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    messages: [
      {
        id: `${id}-message`,
        headers: { from: "a@example.com", subject: "Hello" },
      },
    ],
    plan: undefined,
    ...overrides,
  };
}

function mockPage(threads: unknown[], nextPageToken?: string) {
  vi.mocked(loadThreads).mockResolvedValue({
    threads,
    nextPageToken,
  } as never);
}

function runChunk(
  payload: Partial<BulkRulesPayload> = {},
  {
    checkpoint = vi.fn().mockResolvedValue(false),
  }: { checkpoint?: (...args: unknown[]) => Promise<boolean> } = {},
) {
  const fullPayload: BulkRulesPayload = {
    startDate: "2026-01-01T00:00:00.000Z",
    includeRead: false,
    rerun: false,
    generateDraftReplies: false,
    pageProcessedThreadIds: [],
    ...payload,
  };
  return runBulkRulesChunk({
    job: {
      id: "job-1",
      emailAccountId: "account-1",
      payload: fullPayload,
      result: null,
      progressDone: 0,
    } as never,
    logger,
    checkpoint,
  });
}
