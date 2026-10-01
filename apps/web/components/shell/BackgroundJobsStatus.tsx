"use client";

import Link from "next/link";
import { CheckIcon, LoaderIcon, XIcon } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import {
  isActiveBackgroundJob,
  useBackgroundJobs,
} from "@/hooks/useBackgroundJobs";
import { useAccount } from "@/providers/EmailAccountProvider";
import {
  cancelBackgroundJobAction,
  markBackgroundJobsSeenAction,
} from "@/utils/actions/background-job";
import {
  getBackgroundJobLabel,
  getBackgroundJobPath,
  getBackgroundJobStatusText,
} from "@/components/shell/background-job-display";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import type { GetBackgroundJobsResponse } from "@/app/api/user/background-jobs/route";

type Job = GetBackgroundJobsResponse["jobs"][number];

export function BackgroundJobsStatus() {
  const { emailAccountId } = useAccount();
  const { data, mutate } = useBackgroundJobs();

  const jobs = data?.jobs ?? [];
  const activeJobs = jobs.filter(isActiveBackgroundJob);
  const unseenJobs = jobs.filter(
    (job) => !isActiveBackgroundJob(job) && !job.seenAt,
  );
  const listedJobs = [...activeJobs, ...unseenJobs];

  const { execute: cancel } = useAction(
    cancelBackgroundJobAction.bind(null, emailAccountId),
    { onSettled: () => mutate() },
  );
  const { execute: markSeen } = useAction(
    markBackgroundJobsSeenAction.bind(null, emailAccountId),
    { onSettled: () => mutate() },
  );

  if (listedJobs.length === 0) return null;

  const summary =
    activeJobs.length > 0
      ? `${activeJobs.length} running`
      : `${unseenJobs.length} finished`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted"
        >
          {activeJobs.length > 0 ? (
            <LoaderIcon
              className="size-3.5 shrink-0 animate-spin text-brand"
              aria-hidden
            />
          ) : (
            <CheckIcon className="size-3.5 shrink-0 text-brand" aria-hidden />
          )}
          <span className="truncate">{summary}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-80 p-0">
        <ul className="divide-y">
          {listedJobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              emailAccountId={emailAccountId}
              onCancel={() => cancel({ jobId: job.id })}
              onSeen={() => markSeen({ jobIds: [job.id] })}
            />
          ))}
        </ul>
        {unseenJobs.length > 0 ? (
          <MarkAllSeen
            onClick={() => markSeen({ jobIds: unseenJobs.map((j) => j.id) })}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function JobRow({
  job,
  emailAccountId,
  onCancel,
  onSeen,
}: {
  job: Job;
  emailAccountId: string;
  onCancel: () => void;
  onSeen: () => void;
}) {
  const active = isActiveBackgroundJob(job);
  const percent =
    job.progressTotal && job.progressTotal > 0
      ? Math.min(100, (job.progressDone / job.progressTotal) * 100)
      : 0;

  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={getBackgroundJobPath(emailAccountId, job)}
          className="truncate font-medium text-foreground hover:underline"
        >
          {getBackgroundJobLabel(job.kind)}
        </Link>
        {active ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={job.cancelRequested}
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : (
          <button
            type="button"
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground"
            onClick={onSeen}
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
      {active && job.kind !== "CHAT_REPLY" ? (
        <Progress value={percent} className="h-1.5" innerClassName="bg-brand" />
      ) : null}
      <div className="text-muted-foreground">
        {getBackgroundJobStatusText(job)}
      </div>
    </li>
  );
}

function MarkAllSeen({ onClick }: { onClick: () => void }) {
  return (
    <div className="border-t p-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full text-xs"
        onClick={onClick}
      >
        Dismiss all
      </Button>
    </div>
  );
}
