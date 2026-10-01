import useSWR from "swr";
import type { GetBackgroundJobsResponse } from "@/app/api/user/background-jobs/route";

const ACTIVE_REFRESH_MS = 2000;
const IDLE_REFRESH_MS = 30_000;

type BackgroundJob = GetBackgroundJobsResponse["jobs"][number];

export function useBackgroundJobs() {
  return useSWR<GetBackgroundJobsResponse>("/api/user/background-jobs", {
    refreshInterval: (data) =>
      data?.jobs.some(isActiveBackgroundJob)
        ? ACTIVE_REFRESH_MS
        : IDLE_REFRESH_MS,
  });
}

export function isActiveBackgroundJob(job: Pick<BackgroundJob, "status">) {
  return job.status === "QUEUED" || job.status === "RUNNING";
}
