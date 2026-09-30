import { EmailFirehose } from "@/app/(app)/[emailAccountId]/clean/EmailFirehose";
import { PreviewBatch } from "@/app/(app)/[emailAccountId]/clean/PreviewBatch";
import { Card } from "@/components/ui/card";
import { PageHeading } from "@/components/Typography";
import { StatTile } from "@/components/ui/stat-tile";
import { CleanAction } from "@/generated/prisma/enums";
import type { getThreadsByJobId } from "@/utils/redis/clean";
import type { CleanupJob } from "@/generated/prisma/client";

export function CleanRun({
  isPreviewBatch,
  job,
  threads,
  total,
  done,
}: {
  isPreviewBatch: boolean;
  job: CleanupJob;
  threads: Awaited<ReturnType<typeof getThreadsByJobId>>;
  total: number;
  done: number;
}) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const doneLabel =
    job.action === CleanAction.ARCHIVE ? "Archived" : "Marked read";

  return (
    <div className="mx-auto my-6 w-full max-w-2xl px-4">
      <PageHeading className="mb-5">Deep Clean</PageHeading>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile value={total.toLocaleString()} label="Processed" />
        <StatTile value={done.toLocaleString()} label={doneLabel} />
        <StatTile value={`${percent}%`} label="Complete" />
      </div>
      <div
        className="mb-6 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Progress"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-brand transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>

      {isPreviewBatch && <PreviewBatch job={job} />}
      <Card className="p-6">
        <EmailFirehose
          threads={threads.filter((t) => t.status !== "processing")}
          stats={{ total, done }}
          action={job.action}
        />
      </Card>
    </div>
  );
}
