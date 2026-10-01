import type { BackgroundJobKind } from "@/generated/prisma/enums";
import type { GetBackgroundJobsResponse } from "@/app/api/user/background-jobs/route";
import { prefixPath } from "@/utils/path";

type Job = GetBackgroundJobsResponse["jobs"][number];

const LABELS: Record<BackgroundJobKind, string> = {
  BULK_RULES: "Process past emails",
  CHAT_REPLY: "Assistant reply",
  CLEANUP: "Cleanup",
  CATEGORIZE_SENDERS: "Categorize senders",
};

export function getBackgroundJobLabel(kind: BackgroundJobKind) {
  return LABELS[kind];
}

export function getBackgroundJobPath(
  emailAccountId: string,
  kind: BackgroundJobKind,
) {
  switch (kind) {
    case "CLEANUP":
      return prefixPath(emailAccountId, "/clean");
    case "CATEGORIZE_SENDERS":
      return prefixPath(emailAccountId, "/smart-categories");
    default:
      return prefixPath(emailAccountId, "/assistant");
  }
}

export function getBackgroundJobStatusText(
  job: Pick<
    Job,
    "status" | "progressDone" | "error" | "cancelRequested" | "nextRunAt"
  >,
) {
  const processed = `${job.progressDone} processed`;

  switch (job.status) {
    case "QUEUED":
      return job.nextRunAt && new Date(job.nextRunAt) > new Date()
        ? "Waiting"
        : "Queued";
    case "RUNNING":
      return job.cancelRequested ? "Cancelling" : processed;
    case "SUCCEEDED":
      return processed;
    case "CANCELLED":
      return `Cancelled, ${processed}`;
    case "FAILED":
      return job.error ? `Failed: ${job.error}` : "Failed";
  }
}
