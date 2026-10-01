import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createTestLogger } from "@/__tests__/helpers";
import {
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records a running job holding the chat id", async () => {
    await startChatReplyJob({
      emailAccountId: "account-1",
      chatId: "chat-1",
      runId: "run-1",
      logger,
    });

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

  it("heartbeats while running and stops once finished", async () => {
    const job = await startChatReplyJob({
      emailAccountId: "account-1",
      chatId: "chat-1",
      runId: "run-1",
      logger,
    });

    await vi.advanceTimersByTimeAsync(31_000);
    expect(prisma.backgroundJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "RUNNING" },
      data: { heartbeatAt: expect.any(Date) },
    });

    await job.finish({ status: "SUCCEEDED" });
    prisma.backgroundJob.updateMany.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(prisma.backgroundJob.updateMany).not.toHaveBeenCalled();
  });

  it("finishes once, with the first outcome", async () => {
    const job = await startChatReplyJob({
      emailAccountId: "account-1",
      chatId: "chat-1",
      runId: "run-1",
      logger,
    });

    await job.finish({ status: "FAILED", error: "Reply generation failed" });
    await job.finish({ status: "SUCCEEDED" });

    expect(prisma.backgroundJob.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.backgroundJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "RUNNING" },
      data: expect.objectContaining({
        status: "FAILED",
        error: "Reply generation failed",
        seenAt: expect.any(Date),
      }),
    });
  });

  it("does not fail the chat when the job cannot be recorded", async () => {
    prisma.backgroundJob.create.mockRejectedValue(new Error("db down"));

    const job = await startChatReplyJob({
      emailAccountId: "account-1",
      chatId: "chat-1",
      runId: "run-1",
      logger,
    });
    await job.finish({ status: "SUCCEEDED" });

    expect(prisma.backgroundJob.updateMany).not.toHaveBeenCalled();
  });

  it("looks up only a fresh active job of the chat", async () => {
    prisma.backgroundJob.findFirst.mockResolvedValue({ id: "job-1" } as never);

    await getActiveChatReplyJob({
      emailAccountId: "account-1",
      chatId: "chat-1",
    });

    expect(prisma.backgroundJob.findFirst).toHaveBeenCalledWith({
      where: {
        emailAccountId: "account-1",
        kind: "CHAT_REPLY",
        status: { in: ["QUEUED", "RUNNING"] },
        heartbeatAt: { gte: expect.any(Date) },
        payload: { path: ["chatId"], equals: "chat-1" },
      },
      select: { id: true },
    });
  });
});
