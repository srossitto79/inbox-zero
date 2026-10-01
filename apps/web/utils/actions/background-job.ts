"use server";

import { actionClient } from "@/utils/actions/safe-action";
import {
  cancelBackgroundJobBody,
  markBackgroundJobsSeenBody,
  startBulkRulesJobBody,
} from "@/utils/actions/background-job.validation";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import { checkHasAccess } from "@/utils/premium/server";
import {
  RERUN_MINIMUM_TIER,
  RERUN_UPGRADE_MESSAGE,
} from "@/utils/premium/rerun";
import type { BulkRulesPayload } from "@/utils/background-jobs/bulk-rules.schema";

export const startBulkRulesJobAction = actionClient
  .metadata({ name: "startBulkRulesJob" })
  .inputSchema(startBulkRulesJobBody)
  .action(
    async ({
      ctx: { emailAccountId, userId },
      parsedInput: {
        startDate,
        before,
        includeRead,
        rerun,
        generateDraftReplies,
        maxEmails,
      },
    }) => {
      if (rerun) {
        const hasAccess = await checkHasAccess({
          userId,
          minimumTier: RERUN_MINIMUM_TIER,
        });
        if (!hasAccess) throw new SafeError(RERUN_UPGRADE_MESSAGE);
      }

      const active = await prisma.backgroundJob.findFirst({
        where: {
          emailAccountId,
          kind: "BULK_RULES",
          status: { in: ["QUEUED", "RUNNING"] },
        },
        select: { id: true },
      });
      if (active) throw new SafeError("A bulk run is already in progress.");

      const payload: BulkRulesPayload = {
        startDate: startDate.toISOString(),
        before: before?.toISOString(),
        includeRead,
        rerun,
        generateDraftReplies,
        maxEmails,
        pageProcessedThreadIds: [],
      };
      const job = await prisma.backgroundJob.create({
        data: { emailAccountId, kind: "BULK_RULES", payload },
        select: { id: true },
      });

      return { jobId: job.id };
    },
  );

export const cancelBackgroundJobAction = actionClient
  .metadata({ name: "cancelBackgroundJob" })
  .inputSchema(cancelBackgroundJobBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { jobId } }) => {
    // A queued job has nothing to wind down; a running one stops at its next
    // checkpoint and finishes as cancelled.
    const queued = await prisma.backgroundJob.updateMany({
      where: { id: jobId, emailAccountId, status: "QUEUED" },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });
    if (queued.count > 0) return;

    await prisma.backgroundJob.updateMany({
      where: { id: jobId, emailAccountId, status: "RUNNING" },
      data: { cancelRequested: true },
    });
  });

export const markBackgroundJobsSeenAction = actionClient
  .metadata({ name: "markBackgroundJobsSeen" })
  .inputSchema(markBackgroundJobsSeenBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { jobIds } }) => {
    await prisma.backgroundJob.updateMany({
      where: {
        id: { in: jobIds },
        emailAccountId,
        status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] },
        seenAt: null,
      },
      data: { seenAt: new Date() },
    });
  });
