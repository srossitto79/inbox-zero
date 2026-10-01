import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";

const HEARTBEAT_INTERVAL_MS = 30_000;
const CANCEL_POLL_INTERVAL_MS = 2000;

// Three missed beats: the process that owned the run is gone.
export const CHAT_REPLY_STALE_MS = 3 * HEARTBEAT_INTERVAL_MS;
// A live run beats every 30s, so anything older than this has no owner.
// Used where a fresher heartbeat must never be touched.
export const CHAT_REPLY_ORPHAN_MS = 45_000;

export async function getActiveChatReplyJob({
  emailAccountId,
  chatId,
}: {
  emailAccountId: string;
  chatId?: string;
}) {
  return prisma.backgroundJob.findFirst({
    where: {
      emailAccountId,
      kind: "CHAT_REPLY",
      status: { in: ["QUEUED", "RUNNING"] },
      heartbeatAt: { gte: new Date(Date.now() - CHAT_REPLY_STALE_MS) },
      ...(chatId ? { payload: { path: ["chatId"], equals: chatId } } : {}),
    },
    select: { id: true },
  });
}

/**
 * Fails chat replies whose process is gone. Run at server start, so a restart
 * does not leave the chat blocked until the heartbeat goes stale.
 */
export async function failOrphanedChatReplies(now = new Date()) {
  const { count } = await prisma.backgroundJob.updateMany({
    where: {
      kind: "CHAT_REPLY",
      status: "RUNNING",
      heartbeatAt: { lt: new Date(now.getTime() - CHAT_REPLY_ORPHAN_MS) },
    },
    data: {
      status: "FAILED",
      error: "Interrupted",
      finishedAt: now,
      seenAt: now,
    },
  });
  return count;
}

/**
 * Records one chat run so other pages can see it. Bookkeeping failures are
 * logged and never fail the chat request.
 *
 * `signal` aborts when the user asks to stop the reply.
 */
export async function startChatReplyJob({
  emailAccountId,
  chatId,
  runId,
  logger,
}: {
  emailAccountId: string;
  chatId: string;
  runId: string;
  logger: Logger;
}) {
  const controller = new AbortController();
  let jobId: string | undefined;
  try {
    const now = new Date();
    const job = await prisma.backgroundJob.create({
      data: {
        emailAccountId,
        kind: "CHAT_REPLY",
        status: "RUNNING",
        payload: { chatId, runId },
        startedAt: now,
        heartbeatAt: now,
      },
      select: { id: true },
    });
    jobId = job?.id;
  } catch (error) {
    logger.warn("Failed to record chat reply job", { error });
  }

  let lastHeartbeatAt = Date.now();
  const timer = jobId
    ? setInterval(() => {
        watchJob(jobId);
      }, CANCEL_POLL_INTERVAL_MS)
    : undefined;
  timer?.unref();

  // One poll serves both purposes: it sees a stop request within seconds and
  // keeps the heartbeat on its slower schedule.
  async function watchJob(id: string) {
    try {
      const job = await prisma.backgroundJob.findUnique({
        where: { id },
        select: { status: true, cancelRequested: true },
      });
      if (job?.status !== "RUNNING" || job.cancelRequested) {
        controller.abort();
        return;
      }
      if (Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeatAt = Date.now();
        await prisma.backgroundJob.updateMany({
          where: { id, status: "RUNNING" },
          data: { heartbeatAt: new Date() },
        });
      }
    } catch {
      // The next poll tries again.
    }
  }

  let finished = false;
  return {
    signal: controller.signal,
    /** Safe to call from every terminal path; only the first call counts. */
    async finish(outcome: {
      status: "SUCCEEDED" | "FAILED" | "CANCELLED";
      error?: string;
    }) {
      if (finished) return;
      finished = true;
      if (timer) clearInterval(timer);
      if (!jobId) return;
      const now = new Date();
      try {
        await prisma.backgroundJob.updateMany({
          where: { id: jobId, status: "RUNNING" },
          data: {
            status: outcome.status,
            error: outcome.error ?? null,
            finishedAt: now,
            heartbeatAt: now,
            // A reply is not something to acknowledge.
            seenAt: now,
          },
        });
      } catch (error) {
        logger.warn("Failed to finish chat reply job", { error });
      }
    },
  };
}
