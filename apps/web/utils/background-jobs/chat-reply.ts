import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";

// A chat run heartbeats while it streams; a heartbeat this old means the
// process that owned the run is gone.
const ACTIVE_HEARTBEAT_MS = 2 * 60_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

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
      heartbeatAt: { gte: new Date(Date.now() - ACTIVE_HEARTBEAT_MS) },
      ...(chatId ? { payload: { path: ["chatId"], equals: chatId } } : {}),
    },
    select: { id: true },
  });
}

/**
 * Records one chat run so other pages can see it. Bookkeeping failures are
 * logged and never fail the chat request.
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

  const timer = jobId
    ? setInterval(() => {
        prisma.backgroundJob
          .updateMany({
            where: { id: jobId, status: "RUNNING" },
            data: { heartbeatAt: new Date() },
          })
          .catch(() => undefined);
      }, HEARTBEAT_INTERVAL_MS)
    : undefined;
  timer?.unref();

  let finished = false;
  return {
    /** Safe to call from every terminal path; only the first call counts. */
    async finish(outcome: { status: "SUCCEEDED" | "FAILED"; error?: string }) {
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
