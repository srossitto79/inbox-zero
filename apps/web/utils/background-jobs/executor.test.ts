import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { LocalMailSyncPausedError } from "@/utils/email/local-mail-sync-budget";
import { failOrphanedChatReplies } from "@/utils/background-jobs/chat-reply";
import { runBulkRulesChunk } from "@/utils/background-jobs/bulk-rules";
import {
  runBackgroundJobTick,
  STALE_HEARTBEAT_MS,
  waitForRunningBackgroundJobs,
} from "@/utils/background-jobs/executor";

vi.mock("@/utils/prisma");
vi.mock("server-only", () => ({}));
vi.mock("@/utils/background-jobs/bulk-rules", () => ({
  runBulkRulesChunk: vi.fn(),
}));

type Row = Record<string, unknown> & { id: string };

describe("runBackgroundJobTick", () => {
  let rows: Map<string, Row>;

  beforeEach(() => {
    vi.resetAllMocks();
    rows = new Map();
    installInMemoryJobTable(rows);
  });

  it("runs a job chunk by chunk and saves the cursor after each chunk", async () => {
    addJob(rows, { id: "job-1" });
    const seenPayloads: unknown[] = [];
    vi.mocked(runBulkRulesChunk).mockImplementation(async ({ job }) => {
      seenPayloads.push(job.payload);
      const page = (job.payload as { page: number }).page;
      return {
        payload: { page: page + 1 },
        progressDone: job.progressDone + 25,
        result: { pages: page },
        finished: page === 3,
      };
    });

    await runBackgroundJobTick();
    await waitForRunningBackgroundJobs();

    expect(seenPayloads).toEqual([{ page: 1 }, { page: 2 }, { page: 3 }]);
    expect(rows.get("job-1")).toMatchObject({
      status: "SUCCEEDED",
      progressDone: 75,
      payload: { page: 4 },
    });
    expect(rows.get("job-1")?.finishedAt).toBeInstanceOf(Date);
  });

  it("stops between chunks when cancellation was requested", async () => {
    addJob(rows, { id: "job-1" });
    vi.mocked(runBulkRulesChunk).mockImplementation(async ({ job }) => {
      rows.get(job.id)!.cancelRequested = true;
      return {
        payload: { page: 2 },
        progressDone: 25,
        result: {},
        finished: false,
      };
    });

    await runBackgroundJobTick();
    await waitForRunningBackgroundJobs();

    expect(runBulkRulesChunk).toHaveBeenCalledTimes(1);
    expect(rows.get("job-1")).toMatchObject({
      status: "CANCELLED",
      progressDone: 25,
    });
  });

  it("resumes a running job whose heartbeat is stale from its saved cursor", async () => {
    addJob(rows, {
      id: "job-1",
      status: "RUNNING",
      heartbeatAt: new Date(Date.now() - STALE_HEARTBEAT_MS - 1000),
      payload: { page: 7 },
      progressDone: 150,
    });
    vi.mocked(runBulkRulesChunk).mockResolvedValue({
      payload: { page: 8 },
      progressDone: 175,
      result: {},
      finished: true,
    });

    await runBackgroundJobTick();
    await waitForRunningBackgroundJobs();

    expect(vi.mocked(runBulkRulesChunk).mock.calls[0][0].job.payload).toEqual({
      page: 7,
    });
    expect(rows.get("job-1")?.status).toBe("SUCCEEDED");
  });

  it("leaves a running job with a fresh heartbeat to its owner", async () => {
    addJob(rows, {
      id: "job-1",
      status: "RUNNING",
      heartbeatAt: new Date(),
    });

    await runBackgroundJobTick();
    await waitForRunningBackgroundJobs();

    expect(runBulkRulesChunk).not.toHaveBeenCalled();
  });

  it("requeues the job when the mail sync budget is exhausted", async () => {
    addJob(rows, { id: "job-1" });
    vi.mocked(runBulkRulesChunk).mockRejectedValue(
      new LocalMailSyncPausedError(30_000),
    );

    const before = Date.now();
    await runBackgroundJobTick();
    await waitForRunningBackgroundJobs();

    const row = rows.get("job-1")!;
    expect(row.status).toBe("QUEUED");
    expect((row.nextRunAt as Date).getTime()).toBeGreaterThanOrEqual(
      before + 30_000,
    );
  });

  it("does not start a requeued job before its retry time", async () => {
    addJob(rows, {
      id: "job-1",
      nextRunAt: new Date(Date.now() + 60_000),
    });

    await runBackgroundJobTick();
    await waitForRunningBackgroundJobs();

    expect(runBulkRulesChunk).not.toHaveBeenCalled();
  });

  it("keeps the progress of a chunk that stopped early for the budget", async () => {
    addJob(rows, { id: "job-1" });
    vi.mocked(runBulkRulesChunk).mockResolvedValue({
      payload: { page: 1, pageProcessedThreadIds: ["a", "b"] },
      progressDone: 2,
      result: {},
      finished: false,
      pauseMs: 45_000,
    });

    await runBackgroundJobTick();
    await waitForRunningBackgroundJobs();

    expect(rows.get("job-1")).toMatchObject({
      status: "QUEUED",
      progressDone: 2,
      payload: { page: 1, pageProcessedThreadIds: ["a", "b"] },
    });
  });

  it("runs at most one job per account at a time", async () => {
    addJob(rows, { id: "job-1", status: "RUNNING", heartbeatAt: new Date() });
    addJob(rows, { id: "job-2", createdAt: new Date(Date.now() + 1) });

    await runBackgroundJobTick();
    await waitForRunningBackgroundJobs();

    expect(runBulkRulesChunk).not.toHaveBeenCalled();
    expect(rows.get("job-2")?.status).toBe("QUEUED");
  });

  it("ends the job as failed but keeps its progress when a chunk reports a failure", async () => {
    addJob(rows, { id: "job-1" });
    vi.mocked(runBulkRulesChunk).mockResolvedValue({
      payload: { page: 2 },
      progressDone: 3,
      result: { processed: 3, failed: 3 },
      finished: true,
      failure: "LLM failed",
    });

    await runBackgroundJobTick();
    await waitForRunningBackgroundJobs();

    expect(rows.get("job-1")).toMatchObject({
      status: "FAILED",
      error: "LLM failed",
      progressDone: 3,
      result: { processed: 3, failed: 3 },
    });
  });

  it("does not count a running chat reply against the account's worker slot", async () => {
    addJob(rows, {
      id: "chat-1",
      kind: "CHAT_REPLY",
      status: "RUNNING",
      heartbeatAt: new Date(),
    });
    addJob(rows, { id: "job-1", createdAt: new Date(Date.now() + 1) });
    vi.mocked(runBulkRulesChunk).mockResolvedValue({
      payload: {},
      progressDone: 0,
      result: {},
      finished: true,
    });

    await runBackgroundJobTick();
    await waitForRunningBackgroundJobs();

    expect(rows.get("job-1")?.status).toBe("SUCCEEDED");
    expect(rows.get("chat-1")?.status).toBe("RUNNING");
  });

  it("marks a chat reply whose process died as interrupted", async () => {
    addJob(rows, {
      id: "chat-1",
      kind: "CHAT_REPLY",
      status: "RUNNING",
      heartbeatAt: new Date(Date.now() - STALE_HEARTBEAT_MS - 1000),
    });

    await runBackgroundJobTick();
    await waitForRunningBackgroundJobs();

    expect(rows.get("chat-1")).toMatchObject({
      status: "FAILED",
      error: "Interrupted",
    });
  });

  describe("stale heartbeats by kind", () => {
    it("gives up a chat reply after 90 seconds without a heartbeat", async () => {
      addJob(rows, {
        id: "chat-1",
        kind: "CHAT_REPLY",
        status: "RUNNING",
        heartbeatAt: new Date(Date.now() - 100_000),
      });

      await runBackgroundJobTick();
      await waitForRunningBackgroundJobs();

      expect(rows.get("chat-1")).toMatchObject({
        status: "FAILED",
        error: "Interrupted",
      });
    });

    it("leaves a chat reply with a recent heartbeat alone", async () => {
      addJob(rows, {
        id: "chat-1",
        kind: "CHAT_REPLY",
        status: "RUNNING",
        heartbeatAt: new Date(Date.now() - 60_000),
      });

      await runBackgroundJobTick();
      await waitForRunningBackgroundJobs();

      expect(rows.get("chat-1")?.status).toBe("RUNNING");
    });

    it("keeps the five minute grace period for jobs that resume", async () => {
      addJob(rows, {
        id: "job-1",
        status: "RUNNING",
        heartbeatAt: new Date(Date.now() - 100_000),
      });

      await runBackgroundJobTick();
      await waitForRunningBackgroundJobs();

      expect(runBulkRulesChunk).not.toHaveBeenCalled();
      expect(rows.get("job-1")?.status).toBe("RUNNING");
    });
  });

  describe("failOrphanedChatReplies", () => {
    it("fails chat replies without an owner and leaves a fresh heartbeat alone", async () => {
      addJob(rows, {
        id: "chat-dead",
        kind: "CHAT_REPLY",
        status: "RUNNING",
        heartbeatAt: new Date(Date.now() - 60_000),
      });
      addJob(rows, {
        id: "chat-live",
        kind: "CHAT_REPLY",
        status: "RUNNING",
        heartbeatAt: new Date(Date.now() - 20_000),
      });
      addJob(rows, {
        id: "bulk-old",
        status: "RUNNING",
        heartbeatAt: new Date(Date.now() - 60_000),
      });

      const count = await failOrphanedChatReplies();

      expect(count).toBe(1);
      expect(rows.get("chat-dead")).toMatchObject({
        status: "FAILED",
        error: "Interrupted",
      });
      expect(rows.get("chat-live")?.status).toBe("RUNNING");
      expect(rows.get("bulk-old")?.status).toBe("RUNNING");
    });
  });

  it("fails the job with the error message when a chunk throws", async () => {
    addJob(rows, { id: "job-1" });
    vi.mocked(runBulkRulesChunk).mockRejectedValue(new Error("Boom"));

    await runBackgroundJobTick();
    await waitForRunningBackgroundJobs();

    expect(rows.get("job-1")).toMatchObject({
      status: "FAILED",
      error: "Boom",
    });
  });
});

function addJob(
  rows: Map<string, Row>,
  overrides: Partial<Row> & { id: string },
) {
  rows.set(overrides.id, {
    emailAccountId: "account-1",
    kind: "BULK_RULES",
    status: "QUEUED",
    progressDone: 0,
    progressTotal: null,
    payload: { page: 1 },
    result: null,
    error: null,
    cancelRequested: false,
    nextRunAt: null,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
    heartbeatAt: null,
    seenAt: null,
    ...overrides,
  });
}

// A small in-memory stand-in for the job table, so the tests assert on the
// stored rows rather than on the sequence of queries.
function installInMemoryJobTable(rows: Map<string, Row>) {
  const select = (where: unknown) =>
    [...rows.values()].filter((row) => matches(row, where));
  const copy = (found: Row[]) => found.map((row) => ({ ...row }));

  prisma.backgroundJob.findMany.mockImplementation((async ({
    where,
  }: {
    where: unknown;
  }) =>
    copy(
      select(where).sort(
        (a, b) =>
          (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime(),
      ),
    )) as never);
  prisma.backgroundJob.count.mockImplementation(
    (async ({ where }: { where: unknown }) => select(where).length) as never,
  );
  prisma.backgroundJob.findUnique.mockImplementation((async ({
    where,
  }: {
    where: { id: string };
  }) => {
    const row = rows.get(where.id);
    return row ? { ...row } : null;
  }) as never);
  prisma.backgroundJob.updateMany.mockImplementation((async ({
    where,
    data,
  }: {
    where: unknown;
    data: Record<string, unknown>;
  }) => {
    const targets = select(where);
    for (const row of targets) {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) row[key] = value;
      }
    }
    return { count: targets.length };
  }) as never);
}

function matches(row: Row, where: unknown): boolean {
  return Object.entries(where as Record<string, unknown>).every(
    ([key, condition]) => {
      if (key === "OR") {
        return (condition as unknown[]).some((branch) => matches(row, branch));
      }
      const value = row[key];
      if (condition === null || typeof condition !== "object") {
        return value === condition;
      }
      if (condition instanceof Date) {
        return value instanceof Date && value.getTime() === condition.getTime();
      }
      const operators = condition as Record<string, unknown>;
      return Object.entries(operators).every(([operator, operand]) => {
        if (operator === "not") return value !== operand;
        if (operator === "in") return (operand as unknown[]).includes(value);
        if (!(value instanceof Date)) return false;
        const time = (operand as Date).getTime();
        if (operator === "lt") return value.getTime() < time;
        if (operator === "lte") return value.getTime() <= time;
        if (operator === "gte") return value.getTime() >= time;
        return false;
      });
    },
  );
}
