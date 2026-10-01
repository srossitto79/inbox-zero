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
  job: Pick<Job, "kind" | "payload">,
) {
  switch (job.kind) {
    case "CHAT_REPLY": {
      const chatId = getChatReplyChatId(job);
      return chatId
        ? prefixPath(
            emailAccountId,
            `/assistant?chatId=${encodeURIComponent(chatId)}`,
          )
        : prefixPath(emailAccountId, "/assistant");
    }
    case "CLEANUP":
      return prefixPath(emailAccountId, "/clean");
    case "CATEGORIZE_SENDERS":
      return prefixPath(emailAccountId, "/smart-categories");
    default:
      return prefixPath(emailAccountId, "/assistant");
  }
}

export function getChatReplyChatId(job: Pick<Job, "kind" | "payload">) {
  if (job.kind !== "CHAT_REPLY") return null;
  const chatId = (job.payload as { chatId?: unknown } | null)?.chatId;
  return typeof chatId === "string" ? chatId : null;
}

export function getBackgroundJobStatusText(
  job: Pick<
    Job,
    | "kind"
    | "status"
    | "progressDone"
    | "result"
    | "error"
    | "cancelRequested"
    | "nextRunAt"
  >,
) {
  if (job.kind === "CHAT_REPLY") {
    if (job.status === "FAILED") return "Failed";
    if (job.status === "CANCELLED") return "Reply stopped";
    return isActive(job.status) ? "Generating" : "Done";
  }

  const failedCount = (job.result as { failed?: unknown } | null)?.failed;
  const failed =
    typeof failedCount === "number" && failedCount > 0
      ? `, ${failedCount} failed`
      : "";
  const processed = `${job.progressDone} processed${failed}`;

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
      return job.error
        ? `Failed, ${processed}. ${job.error}`
        : `Failed, ${processed}`;
  }
}

function isActive(status: Job["status"]) {
  return status === "QUEUED" || status === "RUNNING";
}
