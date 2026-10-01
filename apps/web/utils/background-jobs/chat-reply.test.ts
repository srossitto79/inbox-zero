import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createTestLogger } from "@/__tests__/helpers";
import {
  CHAT_REPLY_ORPHAN_MS,
  CHAT_REPLY_STALE_MS,
  failOrphanedChatReplies,
  getActiveChatReplyJob,
  startChatReplyJob,
} from "@/utils/background-jobs/chat-reply";

vi.mock("@/utils/prisma");
vi.mock("server-only", () => ({}));

const logger = createTestLogger();

describe("chat reply job", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prisma.backgroundJob.create.mockResolvedValue({ id: "job-1" } as never);
    prisma.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.backgroundJob.findUnique.mockResolvedValue({
      status: "RUNNING",
      cancelRequested: false,
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function start() {
    return startChatReplyJob({
      emailAccountId: "account-1",
      chatId: "chat-1",
      runId: "run-1",
      logger,
    });
  }

  it("records a running job holding the chat id", async () => {
    await start();

    expect(prisma.backgroundJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        emailAccountId: "account-1",
        kind: "CHAT_REPLY",
        status: "RUNNING",
        payload: { chatId: "chat-1", runId: "run-1" },
      }),
      select: { id: true },
    });
  });

  it("heartbeats every 30 seconds and stops once finished", async () => {
    const job = await start();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(prisma.backgroundJob.updateMany).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(21_000);
    expect(prisma.backgroundJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "RUNNING" },
      data: { heartbeatAt: expect.any(Date) },
    });

    await job.finish({ status: "SUCCEEDED" });
    prisma.backgroundJob.updateMany.mockClear();
    prisma.backgroundJob.findUnique.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(prisma.backgroundJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.backgroundJob.findUnique).not.toHaveBeenCalled();
  });

  it("aborts the signal within seconds of a stop request", async () => {
    const job = await start();
    await vi.advanceTimersByTimeAsync(4000);
    expect(job.signal.aborted).toBe(false);

    prisma.backgroundJob.findUnique.mockResolvedValue({
      status: "RUNNING",
      cancelRequested: true,
    } as never);
    await vi.advanceTimersByTimeAsync(2100);

    expect(job.signal.aborted).toBe(true);
    await job.finish({ status: "CANCELLED" });
  });

  it("aborts the signal when the job was closed from outside", async () => {
    const job = await start();
    prisma.backgroundJob.findUnique.mockResolvedValue({
      status: "CANCELLED",
      cancelRequested: false,
    } as never);

    await vi.advanceTimersByTimeAsync(2100);

    expect(job.signal.aborted).toBe(true);
    await job.finish({ status: "CANCELLED" });
  });

  it("finishes once, with the first outcome", async () => {
    const job = await start();

    await job.finish({ status: "CANCELLED" });
    await job.finish({ status: "SUCCEEDED" });

    expect(prisma.backgroundJob.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.backgroundJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "RUNNING" },
      data: expect.objectContaining({
        status: "CANCELLED",
        seenAt: expect.any(Date),
      }),
    });
  });

  it("does not fail the chat when the job cannot be recorded", async () => {
    prisma.backgroundJob.create.mockRejectedValue(new Error("db down"));

    const job = await start();
    await job.finish({ status: "SUCCEEDED" });

    expect(prisma.backgroundJob.updateMany).not.toHaveBeenCalled();
    expect(job.signal.aborted).toBe(false);
  });

  it("looks up only a job of the chat with a heartbeat inside 90 seconds", async () => {
    prisma.backgroundJob.findFirst.mockResolvedValue({ id: "job-1" } as never);
    vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));

    await getActiveChatReplyJob({
      emailAccountId: "account-1",
      chatId: "chat-1",
    });

    expect(CHAT_REPLY_STALE_MS).toBe(90_000);
    expect(prisma.backgroundJob.findFirst).toHaveBeenCalledWith({
      where: {
        emailAccountId: "account-1",
        kind: "CHAT_REPLY",
        status: { in: ["QUEUED", "RUNNING"] },
        heartbeatAt: { gte: new Date("2026-10-01T11:58:30.000Z") },
        payload: { path: ["chatId"], equals: "chat-1" },
      },
      select: { id: true },
    });
  });
});

describe("failOrphanedChatReplies", () => {
  it("fails only running chat replies older than the orphan threshold", async () => {
    prisma.backgroundJob.updateMany.mockResolvedValue({ count: 2 });
    const now = new Date("2026-10-01T12:00:00.000Z");

    const count = await failOrphanedChatReplies(now);

    expect(count).toBe(2);
    expect(CHAT_REPLY_ORPHAN_MS).toBe(45_000);
    expect(prisma.backgroundJob.updateMany).toHaveBeenCalledWith({
      where: {
        kind: "CHAT_REPLY",
        status: "RUNNING",
        heartbeatAt: { lt: new Date("2026-10-01T11:59:15.000Z") },
      },
      data: expect.objectContaining({ status: "FAILED", error: "Interrupted" }),
    });
  });
});
