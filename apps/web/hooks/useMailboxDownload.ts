import { useEffect, useState } from "react";
import useSWR from "swr";
import type { MailDiagnostics } from "@inboxzero/mail-core/engine";
import { useOptionalMailClient } from "@inboxzero/mail-react/MailEngineProvider";
import { mailboxPredicate } from "@inboxzero/mail-core/queries";
import type { GetMailboxSizeResponse } from "@/app/api/user/mailbox-size/route";
import {
  downloadRatePerMinute,
  downloadRemainingMinutes,
  pushDownloadSample,
  type DownloadSample,
} from "@/utils/mail-engine/download-progress";

const SIZE_REFRESH_MS = 5 * 60_000;
const JOBS_REFRESH_MS = 3000;

/** How much of the mailbox the local engine holds, as threads, and whether it is working on it. */
export function useMailboxDownload(emailAccountId: string) {
  const client = useOptionalMailClient();
  const { data: size } = useSWR<GetMailboxSizeResponse>(
    emailAccountId ? ["/api/user/mailbox-size", emailAccountId] : null,
    ([url]: [string]) => fetch(url).then((response) => response.json()),
    { refreshInterval: SIZE_REFRESH_MS },
  );
  const [samples, setSamples] = useState<DownloadSample[]>([]);
  const [activity, setActivity] = useState<{
    pendingJobs: number;
    backfill: MailDiagnostics["backfill"];
    readAtMs: number;
  }>({ pendingJobs: 0, backfill: null, readAtMs: 0 });

  useEffect(() => {
    setSamples([]);
    if (!client) return;
    const handle = client.observeMailboxCounts({
      accountIds: [emailAccountId],
      targets: [{ id: "all", predicate: mailboxPredicate("all") }],
    });
    const apply = () => {
      const count = handle
        .getSnapshot()
        .data?.counts.find(
          (entry) => entry.id === "all",
        )?.matchingConversations;
      if (count === undefined) return;
      setSamples((current) =>
        pushDownloadSample(current, { at: Date.now(), count }),
      );
    };
    const unsubscribe = handle.subscribe(apply);
    apply();
    return () => {
      unsubscribe();
      handle.close();
    };
  }, [client, emailAccountId]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const read = async () => {
      try {
        const diagnostics = await client.getDiagnostics(emailAccountId);
        if (cancelled) return;
        setActivity({
          pendingJobs: diagnostics.pendingJobs,
          backfill: diagnostics.backfill ?? null,
          readAtMs: Date.now(),
        });
      } catch {
        // The next read retries; the banner keeps the last known state.
      }
    };
    read();
    const timer = setInterval(read, JOBS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, emailAccountId]);

  const syncing = activity.pendingJobs > 0;
  const backfill = activity.backfill ?? null;
  const nowMs = activity.readAtMs;
  const total = size?.threads ?? null;
  const downloaded = samples.at(-1)?.count ?? null;
  if (total === null || downloaded === null || total <= 0) {
    return { progress: null, syncing, backfill, nowMs };
  }

  const remaining = Math.max(0, total - downloaded);
  return {
    syncing,
    backfill,
    nowMs,
    progress: {
      total,
      downloaded: Math.min(downloaded, total),
      percent: Math.min(100, Math.floor((downloaded / total) * 100)),
      complete: remaining <= Math.max(5, total * 0.005),
      minutesLeft: downloadRemainingMinutes(
        remaining,
        downloadRatePerMinute(samples),
      ),
    },
  };
}
