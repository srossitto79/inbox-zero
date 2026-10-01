import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";

const { checkHasAccessMock } = vi.hoisted(() => ({
  checkHasAccessMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
vi.mock("@/utils/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "user-1", email: "user@example.com" },
  })),
}));
vi.mock("@/utils/premium/server", () => ({
  checkHasAccess: checkHasAccessMock,
}));

import {
  cancelBackgroundJobAction,
  markBackgroundJobsSeenAction,
  startBulkRulesJobAction,
} from "@/utils/actions/background-job";
import { RERUN_UPGRADE_MESSAGE } from "@/utils/premium/rerun";

const startBody = {
  startDate: new Date("2026-03-01T00:00:00.000Z"),
  before: new Date("2026-03-08T00:00:00.000Z"),
  includeRead: true,
  rerun: false,
  generateDraftReplies: false,
};

describe("background job actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.emailAccount.findUnique.mockResolvedValue({
      email: "user@example.com",
      account: { userId: "user-1", provider: "google" },
    } as never);
    checkHasAccessMock.mockResolvedValue(true);
  });

  describe("startBulkRulesJobAction", () => {
    it("queues a job holding the run parameters", async () => {
      prisma.backgroundJob.findFirst.mockResolvedValue(null);
      prisma.backgroundJob.create.mockResolvedValue({ id: "job-1" } as never);

      const result = await startBulkRulesJobAction("account-1", startBody);

      expect(result?.data).toEqual({ jobId: "job-1" });
      expect(prisma.backgroundJob.create).toHaveBeenCalledWith({
        data: {
          emailAccountId: "account-1",
          kind: "BULK_RULES",
          payload: expect.objectContaining({
            startDate: "2026-03-01T00:00:00.000Z",
            before: "2026-03-08T00:00:00.000Z",
            includeRead: true,
            rerun: false,
            pageProcessedThreadIds: [],
          }),
        },
        select: { id: true },
      });
    });

    it("refuses a second bulk run while one is active", async () => {
      prisma.backgroundJob.findFirst.mockResolvedValue({
        id: "job-0",
      } as never);

      const result = await startBulkRulesJobAction("account-1", startBody);

      expect(result?.serverError).toBe("A bulk run is already in progress.");
      expect(prisma.backgroundJob.create).not.toHaveBeenCalled();
    });

    it("refuses a rerun without the required plan", async () => {
      checkHasAccessMock.mockResolvedValue(false);

      const result = await startBulkRulesJobAction("account-1", {
        ...startBody,
        rerun: true,
      });

      expect(result?.serverError).toBe(RERUN_UPGRADE_MESSAGE);
      expect(prisma.backgroundJob.create).not.toHaveBeenCalled();
    });

    it("rejects an end before the start", async () => {
      const result = await startBulkRulesJobAction("account-1", {
        ...startBody,
        before: new Date("2026-02-01T00:00:00.000Z"),
      });

      expect(result?.validationErrors).toBeDefined();
      expect(prisma.backgroundJob.create).not.toHaveBeenCalled();
    });
  });

  describe("cancelBackgroundJobAction", () => {
    it("cancels a queued job directly", async () => {
      prisma.backgroundJob.updateMany.mockResolvedValueOnce({ count: 1 });

      await cancelBackgroundJobAction("account-1", { jobId: "job-1" });

      expect(prisma.backgroundJob.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.backgroundJob.updateMany).toHaveBeenCalledWith({
        where: { id: "job-1", emailAccountId: "account-1", status: "QUEUED" },
        data: { status: "CANCELLED", finishedAt: expect.any(Date) },
      });
    });

    it("asks a running job to stop at its next checkpoint", async () => {
      prisma.backgroundJob.updateMany.mockResolvedValue({ count: 0 });

      await cancelBackgroundJobAction("account-1", { jobId: "job-1" });

      expect(prisma.backgroundJob.updateMany).toHaveBeenLastCalledWith({
        where: { id: "job-1", emailAccountId: "account-1", status: "RUNNING" },
        data: { cancelRequested: true },
      });
    });

    it("closes a chat reply whose process is gone at once", async () => {
      prisma.backgroundJob.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      await cancelBackgroundJobAction("account-1", { jobId: "chat-job" });

      expect(prisma.backgroundJob.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.backgroundJob.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: "chat-job",
          emailAccountId: "account-1",
          kind: "CHAT_REPLY",
          status: "RUNNING",
          heartbeatAt: { lt: expect.any(Date) },
        },
        data: expect.objectContaining({ status: "CANCELLED" }),
      });
    });

    it("only treats heartbeats older than 45 seconds as orphaned", async () => {
      prisma.backgroundJob.updateMany.mockResolvedValue({ count: 0 });
      const before = Date.now();

      await cancelBackgroundJobAction("account-1", { jobId: "chat-job" });

      const orphanWhere = prisma.backgroundJob.updateMany.mock.calls[1][0]
        .where as { heartbeatAt: { lt: Date } };
      const age = before - orphanWhere.heartbeatAt.lt.getTime();
      expect(age).toBeGreaterThanOrEqual(44_000);
      expect(age).toBeLessThan(46_000);
    });

    it("stops the active reply of a chat without knowing the job id", async () => {
      prisma.backgroundJob.updateMany.mockResolvedValue({ count: 0 });

      await cancelBackgroundJobAction("account-1", { chatId: "chat-1" });

      expect(prisma.backgroundJob.updateMany).toHaveBeenLastCalledWith({
        where: {
          kind: "CHAT_REPLY",
          payload: { path: ["chatId"], equals: "chat-1" },
          emailAccountId: "account-1",
          status: "RUNNING",
        },
        data: { cancelRequested: true },
      });
    });

    it("does nothing when the job already finished", async () => {
      prisma.backgroundJob.updateMany.mockResolvedValue({ count: 0 });

      const result = await cancelBackgroundJobAction("account-1", {
        jobId: "done-job",
      });

      expect(result?.serverError).toBeUndefined();
      for (const [call] of prisma.backgroundJob.updateMany.mock.calls) {
        expect(call.where).toMatchObject({
          status: expect.stringMatching(/QUEUED|RUNNING/),
        });
      }
    });

    it("needs a job id or a chat id, not both", async () => {
      const none = await cancelBackgroundJobAction("account-1", {});
      const both = await cancelBackgroundJobAction("account-1", {
        jobId: "a",
        chatId: "b",
      });

      expect(none?.validationErrors).toBeDefined();
      expect(both?.validationErrors).toBeDefined();
      expect(prisma.backgroundJob.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("markBackgroundJobsSeenAction", () => {
    it("marks only finished, unseen jobs of the account", async () => {
      await markBackgroundJobsSeenAction("account-1", {
        jobIds: ["job-1", "job-2"],
      });

      expect(prisma.backgroundJob.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["job-1", "job-2"] },
          emailAccountId: "account-1",
          status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] },
          seenAt: null,
        },
        data: { seenAt: expect.any(Date) },
      });
    });
  });
});
