import prisma from "@/utils/prisma";
import { createEmailProvider } from "@/utils/email/provider";
import type { EmailProvider } from "@/utils/email/types";
import {
  gmailMailSyncCosts,
  LocalMailSyncPausedError,
  withLocalMailSyncBudget,
} from "@/utils/email/local-mail-sync-budget";
import { isEmailProviderRateLimitError } from "@/utils/email/is-provider-rate-limit-error";
import {
  getEmailAccountForRuleExecution,
  type EmailAccountForRuleExecution,
} from "@/utils/user/get";
import { runRules } from "@/utils/ai/choose-rule/run-rules";
import { isStoreToken } from "@/utils/mail-engine/server/stored-query-reads";
import { loadThreads, type LoadedThreads } from "@/utils/threads/load";
import type { ThreadsQuery } from "@/utils/threads/validation";
import type { ParsedMessage, RuleWithActions } from "@/utils/types";
import { sleep } from "@/utils/sleep";
import {
  bulkRulesPayloadSchema,
  bulkRulesResultSchema,
  type BulkRulesEntry,
  type BulkRulesPayload,
} from "@/utils/background-jobs/bulk-rules.schema";
import type {
  JobChunkResult,
  JobHandlerContext,
} from "@/utils/background-jobs/executor";

const PAGE_SIZE = 25;
const CONCURRENCY = 3;
const RECENT_ENTRIES = 20;
const MAX_CONSECUTIVE_FAILURES = 5;
const RATE_LIMIT_PAUSE_MS = 60_000;
// A denial this short means another reader holds the account lease for a
// moment, so waiting here is cheaper than returning to the worker tick.
const SHORT_DENIAL_MAX_MS = 5000;
const MAX_BUDGET_ATTEMPTS = 5;

class CancelledWhileWaitingError extends Error {}

/** Lists one page of threads and runs the rules on each eligible one. */
export async function runBulkRulesChunk({
  job,
  logger,
  checkpoint,
}: JobHandlerContext): Promise<JobChunkResult> {
  const payload = bulkRulesPayloadSchema.parse(job.payload);
  const result = bulkRulesResultSchema.parse(job.result ?? {});
  const { emailAccountId } = job;

  const emailAccount = await getEmailAccountForRuleExecution({
    emailAccountId,
  });
  if (!emailAccount) throw new Error("Email account not found");

  const provider = await createEmailProvider({
    emailAccountId,
    provider: emailAccount.account.provider,
    logger,
  });

  const rules = await prisma.rule.findMany({
    where: { emailAccountId, enabled: true },
    include: { actions: true },
  });

  const listPage = () =>
    loadThreads({
      query: buildThreadsQuery(payload),
      emailAccountId,
      emailProvider: provider,
      messageFormat: "metadata",
    });
  let page: Awaited<ReturnType<typeof loadThreads>>;
  try {
    // A page that continues a mailbox-store listing never reaches Gmail, so
    // it has nothing to charge to the budget.
    page = isStoreToken(payload.nextPageToken)
      ? await listPage()
      : await withMailBudget(
          provider,
          emailAccountId,
          gmailMailSyncCosts.list + PAGE_SIZE * gmailMailSyncCosts.message,
          listPage,
          checkpoint,
        );
  } catch (error) {
    if (!(error instanceof CancelledWhileWaitingError)) throw error;
    // Nothing ran; the executor sees the cancel request on its next pass.
    return {
      payload,
      progressDone: job.progressDone,
      result,
      finished: false,
    };
  }

  const alreadyRan = new Set(payload.pageProcessedThreadIds);
  const remainingQuota =
    payload.maxEmails === undefined
      ? Number.POSITIVE_INFINITY
      : payload.maxEmails - job.progressDone;
  const eligible = page.threads
    .filter((thread) => payload.rerun || !thread.plan)
    .filter((thread) => !alreadyRan.has(thread.id))
    .slice(0, Math.max(0, remainingQuota));

  let progressDone = job.progressDone;
  const processedThreadIds = [...payload.pageProcessedThreadIds];
  const totals = { ...result, recent: [...result.recent] };
  let consecutiveFailures = 0;
  let pauseMs: number | undefined;
  let cancelRequested = false;
  let abortedByFailures = false;

  for (
    let index = 0;
    index < eligible.length && !cancelRequested && pauseMs === undefined;
    index += CONCURRENCY
  ) {
    const group = eligible.slice(index, index + CONCURRENCY);
    // The account allows one mailbox read at a time, so reads go one by one;
    // the slow part, running the rules, then goes in parallel.
    const reads: ThreadRead[] = [];
    for (const thread of group) {
      const read = await readThread({
        thread,
        provider,
        emailAccount,
        checkpoint,
        logger,
      });
      reads.push(read);
      if (read.type === "paused" || read.type === "cancelled") break;
    }
    const outcomes = await Promise.all(
      reads.map((read) =>
        read.type === "message"
          ? runThreadRules({
              read,
              provider,
              rules,
              emailAccount,
              payload,
              logger,
            })
          : read,
      ),
    );

    for (const outcome of outcomes) {
      if (outcome.type === "cancelled") {
        cancelRequested = true;
        continue;
      }
      if (outcome.type === "paused") {
        pauseMs = Math.max(pauseMs ?? 0, outcome.pauseMs);
        continue;
      }

      const { entry } = outcome;
      if (entry.failed) totals.firstError ??= outcome.error;
      processedThreadIds.push(entry.threadId);
      progressDone += 1;
      totals.processed += 1;
      totals.recent.unshift(entry);
      if (entry.failed) {
        totals.failed += 1;
        consecutiveFailures += 1;
      } else {
        consecutiveFailures = 0;
        if (entry.ruleName) totals.matched += 1;
      }
    }
    totals.recent.length = Math.min(totals.recent.length, RECENT_ENTRIES);

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      abortedByFailures = true;
      break;
    }
    if (pauseMs !== undefined) break;

    if (cancelRequested) break;
    cancelRequested = await checkpoint({
      progressDone,
      progressTotal: progressDone + (eligible.length - index - group.length),
      result: totals,
    });
  }

  const pageFinished = !cancelRequested && pauseMs === undefined;
  const quotaReached =
    payload.maxEmails !== undefined && progressDone >= payload.maxEmails;
  const finished =
    abortedByFailures ||
    (pageFinished && (quotaReached || !page.nextPageToken));
  const nothingSucceeded =
    totals.processed > 0 && totals.failed === totals.processed;
  const failure =
    finished && (abortedByFailures || nothingSucceeded)
      ? (totals.firstError ?? "Rules failed")
      : undefined;

  const nextPayload: BulkRulesPayload = pageFinished
    ? {
        ...payload,
        nextPageToken: page.nextPageToken,
        pageProcessedThreadIds: [],
      }
    : { ...payload, pageProcessedThreadIds: processedThreadIds };

  return {
    payload: nextPayload,
    progressDone,
    progressTotal: finished ? progressDone : undefined,
    result: totals,
    finished,
    failure,
    pauseMs,
  };
}

type ThreadRead =
  | {
      type: "message";
      thread: LoadedThreads["threads"][number];
      entry: BulkRulesEntry;
      message: ParsedMessage;
    }
  | { type: "done"; entry: BulkRulesEntry; error?: string }
  | { type: "paused"; pauseMs: number }
  | { type: "cancelled" };

type ThreadOutcome = Exclude<ThreadRead, { type: "message" }>;

async function readThread({
  thread,
  provider,
  emailAccount,
  checkpoint,
  logger,
}: {
  thread: LoadedThreads["threads"][number];
  provider: EmailProvider;
  emailAccount: EmailAccountForRuleExecution;
  checkpoint: JobHandlerContext["checkpoint"];
  logger: JobHandlerContext["logger"];
}): Promise<ThreadRead> {
  const latest = thread.messages.at(-1);
  const entry: BulkRulesEntry = {
    threadId: thread.id,
    messageId: latest?.id ?? "",
    from: latest?.headers.from ?? "",
    subject: latest?.headers.subject ?? "",
    ruleName: null,
    failed: false,
  };
  if (!latest) return { type: "done", entry: { ...entry, failed: true } };

  try {
    const message = await withMailBudget(
      provider,
      emailAccount.id,
      gmailMailSyncCosts.message,
      () => provider.getMessage(latest.id),
      checkpoint,
    );
    return { type: "message", thread, entry, message };
  } catch (error) {
    return toFailedRead({ error, entry, thread, emailAccount, logger });
  }
}

async function runThreadRules({
  read,
  provider,
  rules,
  emailAccount,
  payload,
  logger,
}: {
  read: Extract<ThreadRead, { type: "message" }>;
  provider: EmailProvider;
  rules: RuleWithActions[];
  emailAccount: EmailAccountForRuleExecution;
  payload: BulkRulesPayload;
  logger: JobHandlerContext["logger"];
}): Promise<ThreadOutcome> {
  const { entry, thread, message } = read;
  try {
    const results = await runRules({
      isTest: false,
      provider,
      message,
      rules,
      emailAccount,
      logger,
      modelType: "chat",
      skipDraftReplies: !payload.generateDraftReplies,
    });
    return {
      type: "done",
      entry: {
        ...entry,
        ruleName: results.find((item) => item.rule)?.rule?.name ?? null,
      },
    };
  } catch (error) {
    return toFailedRead({ error, entry, thread, emailAccount, logger });
  }
}

function toFailedRead({
  error,
  entry,
  thread,
  emailAccount,
  logger,
}: {
  error: unknown;
  entry: BulkRulesEntry;
  thread: LoadedThreads["threads"][number];
  emailAccount: EmailAccountForRuleExecution;
  logger: JobHandlerContext["logger"];
}): ThreadOutcome {
  if (error instanceof CancelledWhileWaitingError) return { type: "cancelled" };

  const pauseMs = getPauseMs(error, emailAccount.account.provider);
  if (pauseMs !== null) return { type: "paused", pauseMs };

  logger.warn("Bulk rules failed on a thread", {
    threadId: thread.id,
    error,
  });
  return {
    type: "done",
    entry: { ...entry, failed: true },
    error: error instanceof Error ? error.message : "Rules failed",
  };
}

function buildThreadsQuery(payload: BulkRulesPayload): ThreadsQuery {
  return {
    type: "inbox",
    limit: PAGE_SIZE,
    after: new Date(payload.startDate),
    before: payload.before ? new Date(payload.before) : undefined,
    isUnread: payload.includeRead ? undefined : true,
    nextPageToken: payload.nextPageToken,
  };
}

// Mailbox reads are charged to the shared sync budget, so a bulk run cannot
// use up the account Gmail quota. Outlook has its own per-folder budget.
// A short denial is waited out here, a few times at most; anything longer
// goes back to the worker, which requeues the job with a delay.
async function withMailBudget<T>(
  provider: EmailProvider,
  emailAccountId: string,
  cost: number,
  operation: () => Promise<T>,
  checkpoint: JobHandlerContext["checkpoint"],
): Promise<T> {
  if (provider.name !== "google") return operation();

  for (let attempt = 1; ; attempt++) {
    try {
      return await withLocalMailSyncBudget(
        { emailAccountId, provider: "google", priority: "backfill", cost },
        operation,
      );
    } catch (error) {
      const retryable =
        error instanceof LocalMailSyncPausedError &&
        error.retryAfterMs <= SHORT_DENIAL_MAX_MS &&
        attempt < MAX_BUDGET_ATTEMPTS;
      if (!retryable) throw error;

      await sleep(error.retryAfterMs);
      if (await checkpoint()) throw new CancelledWhileWaitingError();
    }
  }
}

function getPauseMs(error: unknown, provider: string) {
  if (error instanceof LocalMailSyncPausedError) return error.retryAfterMs;
  if (isEmailProviderRateLimitError({ error, provider }))
    return RATE_LIMIT_PAUSE_MS;
  return null;
}
