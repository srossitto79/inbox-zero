import type { BackgroundJob, Prisma } from "@/generated/prisma/client";
import type { BackgroundJobKind } from "@/generated/prisma/enums";
import prisma from "@/utils/prisma";
import { createScopedLogger, type Logger } from "@/utils/logger";
import { LocalMailSyncPausedError } from "@/utils/email/local-mail-sync-budget";
import { isEmailProviderRateLimitError } from "@/utils/email/is-provider-rate-limit-error";
import { runBulkRulesChunk } from "@/utils/background-jobs/bulk-rules";
import { CHAT_REPLY_STALE_MS } from "@/utils/background-jobs/chat-reply";

const logger = createScopedLogger("background-jobs");

// A running job heartbeats after every group of messages, so a heartbeat this
// old means the process that claimed it is gone.
export const STALE_HEARTBEAT_MS = 5 * 60_000;
const MAX_CONCURRENT_JOBS = 3;
const MAX_RUNNING_JOBS_PER_ACCOUNT = 1;
const DEFAULT_PAUSE_MS = 60_000;

export type JobChunkResult = {
  payload: Prisma.InputJsonValue;
  progressDone: number;
  progressTotal?: number;
  result: Prisma.InputJsonValue;
  finished: boolean;
  /** With `finished`: ends the job as failed, keeping the saved progress. */
  failure?: string;
  /** Set when the chunk stopped early because the provider asked to slow down. */
  pauseMs?: number;
};

export type JobHandlerContext = {
  job: BackgroundJob;
  logger: Logger;
  /** Records liveness and progress; resolves true when the user asked to stop. */
  checkpoint: (progress?: {
    progressDone: number;
    progressTotal?: number;
    result: Prisma.InputJsonValue;
  }) => Promise<boolean>;
};

type JobHandler = (context: JobHandlerContext) => Promise<JobChunkResult>;

const handlers: Partial<Record<BackgroundJobKind, JobHandler>> = {
  BULK_RULES: runBulkRulesChunk,
};

const runningJobs = new Map<string, Promise<void>>();

/**
 * Claims jobs that are due and runs them in the background of this process.
 * Safe to call from several processes: a claim only succeeds for one of them.
 */
export async function runBackgroundJobTick(now = new Date()) {
  if (runningJobs.size >= MAX_CONCURRENT_JOBS) return;

  const staleBefore = new Date(now.getTime() - STALE_HEARTBEAT_MS);
  const candidates = await prisma.backgroundJob.findMany({
    where: {
      OR: [
        {
          status: "QUEUED",
          OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
        },
        ...staleRunningConditions(now, staleBefore),
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  for (const candidate of candidates) {
    if (runningJobs.size >= MAX_CONCURRENT_JOBS) return;
    if (runningJobs.has(candidate.id)) continue;

    const activeOnAccount = await prisma.backgroundJob.count({
      where: {
        emailAccountId: candidate.emailAccountId,
        // Jobs another part of the app runs itself do not take a worker slot.
        kind: { in: Object.keys(handlers) as BackgroundJobKind[] },
        status: "RUNNING",
        heartbeatAt: { gte: staleBefore },
        id: { not: candidate.id },
      },
    });
    if (activeOnAccount >= MAX_RUNNING_JOBS_PER_ACCOUNT) continue;

    const claimed = await claimJob(candidate, now, staleBefore);
    if (!claimed) continue;

    runningJobs.set(
      candidate.id,
      runJob(candidate.id)
        .catch((error) => {
          logger.error("Background job crashed", {
            jobId: candidate.id,
            error,
          });
        })
        .finally(() => runningJobs.delete(candidate.id)),
    );
  }
}

export async function waitForRunningBackgroundJobs() {
  await Promise.all(runningJobs.values());
}

// Kinds that resume get a long grace period; a chat reply cannot resume, so it
// is given up as soon as its heartbeat has clearly stopped.
function staleRunningConditions(now: Date, staleBefore: Date) {
  return [
    {
      status: "RUNNING" as const,
      kind: { in: Object.keys(handlers) as BackgroundJobKind[] },
      heartbeatAt: { lt: staleBefore },
    },
    {
      status: "RUNNING" as const,
      kind: "CHAT_REPLY" as const,
      heartbeatAt: { lt: new Date(now.getTime() - CHAT_REPLY_STALE_MS) },
    },
  ];
}

async function claimJob(
  candidate: BackgroundJob,
  now: Date,
  staleBefore: Date,
) {
  const { count } = await prisma.backgroundJob.updateMany({
    where: {
      id: candidate.id,
      OR: [
        {
          status: "QUEUED",
          OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
        },
        ...staleRunningConditions(now, staleBefore),
      ],
    },
    data: {
      status: "RUNNING",
      startedAt: candidate.startedAt ?? now,
      heartbeatAt: now,
      nextRunAt: null,
    },
  });
  return count === 1;
}

async function runJob(jobId: string) {
  while (true) {
    const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
    if (job?.status !== "RUNNING") return;

    const jobLogger = logger.with({
      jobId,
      kind: job.kind,
      emailAccountId: job.emailAccountId,
    });

    if (job.cancelRequested) {
      await finishJob(jobId, { status: "CANCELLED" });
      return;
    }

    const handler = handlers[job.kind];
    if (!handler) {
      await finishJob(jobId, {
        status: "FAILED",
        error: "Interrupted",
      });
      return;
    }

    let chunk: JobChunkResult;
    try {
      chunk = await handler({
        job,
        logger: jobLogger,
        checkpoint: (progress) => checkpointJob(jobId, progress),
      });
    } catch (error) {
      const pauseMs = getPauseMs(error);
      if (pauseMs !== null) {
        jobLogger.warn("Background job paused", { pauseMs });
        await requeueJob(jobId, pauseMs);
        return;
      }

      jobLogger.error("Background job failed", { error });
      await finishJob(jobId, {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return;
    }

    await prisma.backgroundJob.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: {
        payload: chunk.payload,
        progressDone: chunk.progressDone,
        progressTotal: chunk.progressTotal,
        result: chunk.result,
        heartbeatAt: new Date(),
      },
    });

    if (chunk.finished) {
      await finishJob(
        jobId,
        chunk.failure
          ? { status: "FAILED", error: chunk.failure }
          : { status: "SUCCEEDED" },
      );
      return;
    }

    if (chunk.pauseMs !== undefined) {
      await requeueJob(jobId, chunk.pauseMs);
      return;
    }
  }
}

async function checkpointJob(
  jobId: string,
  progress?: {
    progressDone: number;
    progressTotal?: number;
    result: Prisma.InputJsonValue;
  },
) {
  await prisma.backgroundJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: { heartbeatAt: new Date(), ...progress },
  });
  const job = await prisma.backgroundJob.findUnique({
    where: { id: jobId },
    select: { cancelRequested: true },
  });
  return job?.cancelRequested ?? false;
}

async function finishJob(
  jobId: string,
  outcome: { status: "SUCCEEDED" | "FAILED" | "CANCELLED"; error?: string },
) {
  await prisma.backgroundJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: {
      status: outcome.status,
      error: outcome.error ?? null,
      finishedAt: new Date(),
      heartbeatAt: new Date(),
    },
  });
}

async function requeueJob(jobId: string, delayMs: number) {
  await prisma.backgroundJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: {
      status: "QUEUED",
      nextRunAt: new Date(Date.now() + delayMs),
    },
  });
}

function getPauseMs(error: unknown): number | null {
  if (error instanceof LocalMailSyncPausedError) return error.retryAfterMs;
  // A job does not know its provider here, and a raw provider error carries
  // no provider tag, so both providers are checked.
  if (
    isEmailProviderRateLimitError({ error, provider: "google" }) ||
    isEmailProviderRateLimitError({ error, provider: "microsoft" })
  ) {
    return DEFAULT_PAUSE_MS;
  }
  return null;
}
