"use client";

import { useEffect, useState } from "react";
import { addDays } from "date-fns/addDays";
import { startOfDay } from "date-fns/startOfDay";
import { SquareIcon } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@/components/ui/button";
import { LoadingContent } from "@/components/LoadingContent";
import { toastError } from "@/components/Toast";
import { PremiumAlertWithData } from "@/components/PremiumAlert";
import { usePremium } from "@/hooks/usePremium";
import { SetDateDropdown } from "@/app/(app)/[emailAccountId]/assistant/SetDateDropdown";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAccount } from "@/providers/EmailAccountProvider";
import { Switch } from "@/components/ui/switch";
import {
  Item,
  ItemActions,
  ItemCard,
  ItemContent,
  ItemDescription,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { hasTierAccess } from "@/utils/premium";
import { RERUN_MINIMUM_TIER } from "@/utils/premium/rerun";
import { usePremiumModal } from "@/app/(app)/premium/PremiumModal";
import { ActivityLog } from "@/app/(app)/[emailAccountId]/assistant/BulkProcessActivityLog";
import { EndTrialButton } from "@/components/EndTrialButton";
import { useAiAutomationStatus } from "@/hooks/useAiAutomationStatus";
import {
  isActiveBackgroundJob,
  useBackgroundJobs,
} from "@/hooks/useBackgroundJobs";
import {
  cancelBackgroundJobAction,
  markBackgroundJobsSeenAction,
  startBulkRulesJobAction,
} from "@/utils/actions/background-job";
import {
  bulkRulesPayloadSchema,
  bulkRulesResultSchema,
} from "@/utils/background-jobs/bulk-rules.schema";
import { getBackgroundJobStatusText } from "@/components/shell/background-job-display";
import { getActionErrorMessage } from "@/utils/error";

const TRIAL_BULK_PROCESS_EMAIL_LIMIT = 200;

export function BulkRunRules() {
  const { emailAccountId } = useAccount();

  const [isOpen, setIsOpen] = useState(false);
  const { PremiumModal, openModal: openPremiumModal } = usePremiumModal();

  const { data: jobsData, mutate: mutateJobs } = useBackgroundJobs();
  const job = jobsData?.jobs.find((item) => item.kind === "BULK_RULES");
  const isBusy = job ? isActiveBackgroundJob(job) : false;

  const { executeAsync: startJob, isExecuting: isStarting } = useAction(
    startBulkRulesJobAction.bind(null, emailAccountId),
    {
      onSuccess: () => mutateJobs(),
      onError: ({ error }) =>
        toastError({
          title: "Failed to start",
          description: getActionErrorMessage(error),
        }),
    },
  );
  const { execute: cancelJob, isExecuting: isCancelling } = useAction(
    cancelBackgroundJobAction.bind(null, emailAccountId),
    { onSettled: () => mutateJobs() },
  );
  const { execute: markSeen } = useAction(
    markBackgroundJobsSeenAction.bind(null, emailAccountId),
    { onSettled: () => mutateJobs() },
  );

  // A job finished while the dialog is open counts as seen.
  const unseenFinishedJobId =
    isOpen && job && !isBusy && !job.seenAt ? job.id : null;
  useEffect(() => {
    if (unseenFinishedJobId) markSeen({ jobIds: [unseenFinishedJobId] });
  }, [unseenFinishedJobId, markSeen]);

  const {
    hasAiAccess,
    isLoading: isLoadingPremium,
    premium,
    tier,
  } = usePremium();
  const { data: aiAutomationStatus } = useAiAutomationStatus();

  const isBusinessPlusTier = hasTierAccess({
    tier: tier || null,
    minimumTier: "PROFESSIONAL_MONTHLY",
  });
  const hasRerunAccess = hasTierAccess({
    tier: tier || null,
    minimumTier: RERUN_MINIMUM_TIER,
  });
  const isTrial = premium?.stripeSubscriptionStatus === "trialing";
  const trialAiLimitMessage =
    aiAutomationStatus?.status === "trial_ai_limit_reached"
      ? aiAutomationStatus.message
      : null;

  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [includeRead, setIncludeRead] = useState(false);
  const [rerun, setRerun] = useState(false);
  const [generateDraftReplies, setGenerateDraftReplies] = useState(false);

  // Access can drop while a toggle is still on (the tier is revalidated in
  // the background), so everything reads the gated values rather than the raw
  // toggle state.
  const isIncludeReadEnabled = includeRead && isBusinessPlusTier;
  const isRerunEnabled = rerun && hasRerunAccess;

  const handleStart = async () => {
    if (!startDate) {
      toastError({ description: "Please select a start date" });
      return;
    }

    await startJob({
      startDate,
      // Provider "before" filters are exclusive; the selected calendar day is inclusive.
      before: endDate ? startOfDay(addDays(endDate, 1)) : undefined,
      includeRead: isIncludeReadEnabled,
      generateDraftReplies,
      rerun: isRerunEnabled,
      maxEmails: isTrial ? TRIAL_BULK_PROCESS_EMAIL_LIMIT : undefined,
    });
  };

  return (
    <div>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            Process Past Emails
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Bulk Process Emails</DialogTitle>
            <DialogDescription>
              Run your rules on emails already in your inbox.
            </DialogDescription>
          </DialogHeader>
          <LoadingContent loading={isLoadingPremium}>
            <div className="flex min-w-0 flex-col space-y-4 overflow-hidden">
              <PremiumAlertWithData className="mr-auto" />

              <div className="grid grid-cols-2 gap-2">
                <SetDateDropdown
                  onChange={setStartDate}
                  value={startDate}
                  placeholder="Set start date"
                  disabled={isBusy}
                />
                <SetDateDropdown
                  onChange={setEndDate}
                  value={endDate}
                  placeholder="Set end date (optional)"
                  disabled={isBusy}
                />
              </div>

              <ItemCard>
                <ToggleRow
                  title="Include read emails"
                  checked={isIncludeReadEnabled}
                  onCheckedChange={setIncludeRead}
                  disabled={isBusy}
                  onUpgrade={isBusinessPlusTier ? undefined : openPremiumModal}
                />
                <ItemSeparator />
                <ToggleRow
                  title="Rerun rules on already processed emails"
                  checked={isRerunEnabled}
                  onCheckedChange={setRerun}
                  disabled={isBusy}
                  onUpgrade={hasRerunAccess ? undefined : openPremiumModal}
                />
                <ItemSeparator />
                <ToggleRow
                  title="Generate draft replies"
                  checked={generateDraftReplies}
                  onCheckedChange={setGenerateDraftReplies}
                  disabled={isBusy}
                />
              </ItemCard>

              {isTrial && (
                <div className="flex flex-col gap-3 rounded-md border border-queue-waiting/30 bg-queue-waiting/10 px-3 py-2 text-sm text-queue-waiting sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {trialAiLimitMessage ??
                      `Trials can process up to ${TRIAL_BULK_PROCESS_EMAIL_LIMIT} past emails at a time.`}
                  </span>
                  <EndTrialButton
                    size="sm"
                    variant="outline"
                    className="self-start border-queue-waiting/30 bg-card text-queue-waiting hover:bg-queue-waiting/10 sm:self-auto"
                  />
                </div>
              )}

              {job && <BulkRunJobPanel job={job} />}

              {!isBusy && (
                <Button
                  type="button"
                  disabled={
                    !startDate ||
                    !emailAccountId ||
                    !hasAiAccess ||
                    trialAiLimitMessage !== null ||
                    isStarting
                  }
                  onClick={handleStart}
                >
                  Process Emails
                </Button>
              )}
              {isBusy && job && (
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={job.cancelRequested || isCancelling}
                    onClick={() => cancelJob({ jobId: job.id })}
                  >
                    <SquareIcon className="mr-1.5 h-3.5 w-3.5" />
                    Stop
                  </Button>
                </div>
              )}
            </div>
          </LoadingContent>
          <PremiumModal />
        </DialogContent>
      </Dialog>
    </div>
  );
}

type BulkRunJob = NonNullable<
  ReturnType<typeof useBackgroundJobs>["data"]
>["jobs"][number];

function BulkRunJobPanel({ job }: { job: BulkRunJob }) {
  const result = bulkRulesResultSchema.safeParse(job.result ?? {});
  const payload = bulkRulesPayloadSchema.safeParse(job.payload);
  const isActive = isActiveBackgroundJob(job);
  const percent =
    job.progressTotal && job.progressTotal > 0
      ? Math.min(100, (job.progressDone / job.progressTotal) * 100)
      : 0;
  const entries = result.success
    ? result.data.recent.map((entry) => ({
        id: entry.messageId || entry.threadId,
        from: entry.from || "Unknown",
        subject: entry.subject || "(No subject)",
        status: "completed" as const,
        ruleName: entry.ruleName ?? undefined,
        failed: entry.failed,
      }))
    : [];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {isActive && (
          <Progress
            value={percent}
            className="h-1.5"
            innerClassName="bg-brand"
          />
        )}
        <div className="text-sm text-muted-foreground">
          {getBackgroundJobStatusText(job)}
        </div>
      </div>

      <ActivityLog entries={entries} />

      {job.status === "SUCCEEDED" &&
        job.progressDone === 0 &&
        payload.success && (
          <div className="rounded-md border border-queue-waiting/30 bg-queue-waiting/10 px-3 py-2 text-sm text-queue-waiting">
            No{" "}
            {describeTargetedEmails({
              includeRead: payload.data.includeRead,
              rerun: payload.data.rerun,
            })}{" "}
            found in your inbox in the selected date range.
          </div>
        )}
    </div>
  );
}

function ToggleRow({
  title,
  checked,
  onCheckedChange,
  disabled,
  onUpgrade,
}: {
  title: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled: boolean;
  onUpgrade?: () => void;
}) {
  return (
    <Item size="sm">
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        {onUpgrade && (
          <ItemDescription>Available on the Professional plan.</ItemDescription>
        )}
      </ItemContent>
      <ItemActions>
        {onUpgrade ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`Upgrade to use ${title.toLowerCase()}`}
            onClick={onUpgrade}
          >
            Upgrade
          </Button>
        ) : (
          <Switch
            aria-label={title}
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
          />
        )}
      </ItemActions>
    </Item>
  );
}

function describeTargetedEmails({
  includeRead,
  rerun,
}: {
  includeRead: boolean;
  rerun: boolean;
}) {
  const qualifiers = [
    includeRead ? null : "unread",
    rerun ? null : "unprocessed",
  ].filter(Boolean);

  return qualifiers.length ? `${qualifiers.join(", ")} emails` : "emails";
}
