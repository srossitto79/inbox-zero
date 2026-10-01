import prisma from "@/utils/prisma";

const RECENT_FINISHED_MS = 24 * 60 * 60 * 1000;

const backgroundJobSelect = {
  id: true,
  kind: true,
  status: true,
  progressDone: true,
  progressTotal: true,
  payload: true,
  result: true,
  error: true,
  cancelRequested: true,
  nextRunAt: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  seenAt: true,
} as const;

/** Active jobs, jobs finished within a day, and finished jobs not yet seen. */
export async function getBackgroundJobs({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  const jobs = await prisma.backgroundJob.findMany({
    where: {
      emailAccountId,
      OR: [
        { status: { in: ["QUEUED", "RUNNING"] } },
        { seenAt: null },
        { finishedAt: { gte: new Date(Date.now() - RECENT_FINISHED_MS) } },
      ],
    },
    select: backgroundJobSelect,
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return { jobs };
}

export async function getBackgroundJob({
  emailAccountId,
  jobId,
}: {
  emailAccountId: string;
  jobId: string;
}) {
  const job = await prisma.backgroundJob.findFirst({
    where: { id: jobId, emailAccountId },
    select: backgroundJobSelect,
  });
  return { job };
}
