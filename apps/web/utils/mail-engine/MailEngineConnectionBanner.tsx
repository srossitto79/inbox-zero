"use client";

import { memo, useEffect, useState } from "react";
import { useOptionalMailClient } from "@inboxzero/mail-react/MailEngineProvider";
import { AppAlertBanner } from "@/app/(app)/AppAlertBanner";
import { Button } from "@/components/ui/button";
import { toastError } from "@/components/Toast";
import { useAccount } from "@/providers/EmailAccountProvider";
import { getAccountLinkingUrl } from "@/utils/account-linking";
import { isMicrosoftProvider } from "@/utils/email/provider-types";
import { mailEngineConnectionCopy } from "@/utils/mail-engine/connection-notice";
import { redirectToSafeUrl } from "@/utils/redirect";
import { RefreshCwIcon } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { useMailboxDownload } from "@/hooks/useMailboxDownload";
import { cn } from "@/utils";
import { format } from "date-fns";
import {
  formatDuration,
  formatWait,
} from "@/utils/mail-engine/download-progress";

export const MailEngineConnectionBanner = memo(
  function MailEngineConnectionBanner() {
    const { emailAccountId, provider } = useAccount();
    const client = useOptionalMailClient();
    const [connection, setConnection] = useState<
      "ready" | "offline" | "blocked_auth" | undefined
    >();
    const [reconnecting, setReconnecting] = useState(false);
    const copy = mailEngineConnectionCopy(connection);
    const { progress, syncing, backfill, nowMs } =
      useMailboxDownload(emailAccountId);
    const [requesting, setRequesting] = useState(false);
    const busy = syncing || requesting;

    useEffect(() => {
      if (!client || !emailAccountId) {
        setConnection(undefined);
        return;
      }
      const handle = client.observeMailbox({
        accountIds: [emailAccountId],
        predicate: { kind: "role", role: "inbox" },
        order: "newest_first",
        pageSize: 1,
        after: null,
      });
      const apply = () => {
        setConnection(handle.getSnapshot().data?.connection);
      };
      const unsubscribe = handle.subscribe(apply);
      apply();
      return () => {
        unsubscribe();
        handle.close();
      };
    }, [client, emailAccountId]);

    const downloading =
      (connection === "ready" && progress && !progress.complete) ||
      (connection === "ready" && Boolean(backfill));

    if (!copy && !downloading) return null;

    if (connection === "offline" || downloading) {
      const providerLabel = isMicrosoftProvider(provider) ? "Outlook" : "Gmail";
      return (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-border border-b px-4 py-2 text-muted-foreground text-sm"
          role="status"
        >
          <span>
            {syncStatusText({
              paused: connection === "offline",
              backfill,
              nowMs,
              providerLabel,
            })}
          </span>
          {progress && !progress.complete ? (
            <DownloadProgress progress={progress} />
          ) : (
            <span className="flex-1" />
          )}
          <Tooltip content={busy ? "Syncing" : "Sync now"}>
            <Button
              aria-label="Sync now"
              disabled={busy || !client}
              onClick={() => {
                if (!client) return;
                setRequesting(true);
                client
                  .requestSync([emailAccountId])
                  .catch((error: unknown) => {
                    toastError({
                      title: "Sync failed",
                      description:
                        error instanceof Error ? error.message : undefined,
                    });
                  })
                  .finally(() => setRequesting(false));
              }}
              size="iconXs"
              variant="outline"
            >
              <RefreshCwIcon
                className={cn("size-3.5", busy && "animate-spin")}
              />
            </Button>
          </Tooltip>
        </div>
      );
    }

    if (!copy) return null;

    return (
      <AppAlertBanner
        action={
          copy.action ? (
            <Button
              disabled={reconnecting || !emailAccountId}
              onClick={() => {
                setReconnecting(true);
                getAccountLinkingUrl(
                  isMicrosoftProvider(provider) ? "microsoft" : "google",
                  { reconnectEmailAccountId: emailAccountId },
                )
                  .then((url) =>
                    redirectToSafeUrl(url, { allowExternal: true }),
                  )
                  .catch((error: unknown) => {
                    toastError({
                      title: "Error initiating reconnection",
                      description:
                        error instanceof Error
                          ? error.message
                          : "Please try again or contact support",
                    });
                  })
                  .finally(() => setReconnecting(false));
              }}
              size="sm"
            >
              {copy.action}
            </Button>
          ) : null
        }
        description={copy.description}
        title={copy.title}
      />
    );
  },
);

function syncStatusText({
  paused,
  backfill,
  nowMs,
  providerLabel,
}: {
  paused: boolean;
  backfill: {
    nextAttemptAtMs: number | null;
    pauseReason: string | null;
  } | null;
  nowMs: number;
  providerLabel: string;
}) {
  // The download's own schedule wins: the account-wide paused flag stays set
  // after a rejected catch-up even while the download keeps going.
  const nextAttemptAtMs = backfill?.nextAttemptAtMs;
  if (nextAttemptAtMs && nowMs && nextAttemptAtMs > nowMs) {
    const reason =
      PAUSE_REASONS[backfill?.pauseReason ?? ""]?.(providerLabel) ??
      "Download paused";
    return `${reason} · next try ${format(nextAttemptAtMs, "p")} (${formatWait(
      nextAttemptAtMs - nowMs,
    )})`;
  }
  if (backfill || !paused) return "Downloading mailbox";
  return "Sync paused";
}

const PAUSE_REASONS: Record<string, (provider: string) => string> = {
  throttled: (provider) => `Paused by ${provider} rate limit`,
  unavailable: (provider) => `${provider} unavailable`,
};

function DownloadProgress({
  progress,
}: {
  progress: {
    total: number;
    downloaded: number;
    percent: number;
    minutesLeft: number | null;
  };
}) {
  const formatter = new Intl.NumberFormat();
  return (
    <div className="flex min-w-48 flex-1 items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <span className="whitespace-nowrap text-xs">
        {formatter.format(progress.downloaded)} of{" "}
        {formatter.format(progress.total)} · {progress.percent}%
        {progress.minutesLeft === null
          ? ""
          : ` · ~${formatDuration(progress.minutesLeft)}`}
      </span>
    </div>
  );
}
