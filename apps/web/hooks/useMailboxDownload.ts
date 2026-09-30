import { useEffect, useState } from "react";
import useSWR from "swr";
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
  const [syncing, setSyncing] = useState(false);

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
        if (!cancelled) setSyncing(diagnostics.pendingJobs > 0);
      } catch {
        if (!cancelled) setSyncing(false);
      }
    };
    read();
    const timer = setInterval(read, JOBS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, emailAccountId]);

  const total = size?.threads ?? null;
  const downloaded = samples.at(-1)?.count ?? null;
  if (total === null || downloaded === null || total <= 0) {
    return { progress: null, syncing };
  }

  const remaining = Math.max(0, total - downloaded);
  return {
    syncing,
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
