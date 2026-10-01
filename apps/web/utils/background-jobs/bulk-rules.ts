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
import { loadThreads, type LoadedThreads } from "@/utils/threads/load";
import type { ThreadsQuery } from "@/utils/threads/validation";
import type { RuleWithActions } from "@/utils/types";
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

  const page = await withMailBudget(
    provider,
    emailAccountId,
    gmailMailSyncCosts.list + PAGE_SIZE * gmailMailSyncCosts.message,
    () =>
      loadThreads({
        query: buildThreadsQuery(payload),
        emailAccountId,
        emailProvider: provider,
        messageFormat: "metadata",
      }),
  );

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

  for (
    let index = 0;
    index < eligible.length && !cancelRequested && pauseMs === undefined;
    index += CONCURRENCY
  ) {
    const group = eligible.slice(index, index + CONCURRENCY);
    const outcomes = await Promise.all(
      group.map((thread) =>
        processThread({
          thread,
          provider,
          rules,
          emailAccount,
          payload,
          logger,
        }),
      ),
    );

    for (const outcome of outcomes) {
      if (outcome.type === "paused") {
        pauseMs = Math.max(pauseMs ?? 0, outcome.pauseMs);
        continue;
      }

      const { entry } = outcome;
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
      throw new Error("Rules failed on several emails in a row");
    }
    if (pauseMs !== undefined) break;

    cancelRequested = await checkpoint({
      progressDone,
      progressTotal: progressDone + (eligible.length - index - group.length),
      result: totals,
    });
  }

  const pageFinished = !cancelRequested && pauseMs === undefined;
  const quotaReached =
    payload.maxEmails !== undefined && progressDone >= payload.maxEmails;
  const finished = pageFinished && (quotaReached || !page.nextPageToken);

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
    pauseMs,
  };
}

async function processThread({
  thread,
  provider,
  rules,
  emailAccount,
  payload,
  logger,
}: {
  thread: LoadedThreads["threads"][number];
  provider: EmailProvider;
  rules: RuleWithActions[];
  emailAccount: EmailAccountForRuleExecution;
  payload: BulkRulesPayload;
  logger: JobHandlerContext["logger"];
}): Promise<
  { type: "done"; entry: BulkRulesEntry } | { type: "paused"; pauseMs: number }
> {
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
    );
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
    const pauseMs = getPauseMs(error, emailAccount.account.provider);
    if (pauseMs !== null) return { type: "paused", pauseMs };

    logger.warn("Bulk rules failed on a thread", {
      threadId: thread.id,
      error,
    });
    return { type: "done", entry: { ...entry, failed: true } };
  }
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
// use up the account's Gmail quota. Outlook has its own per-folder budget.
function withMailBudget<T>(
  provider: EmailProvider,
  emailAccountId: string,
  cost: number,
  operation: () => Promise<T>,
): Promise<T> {
  if (provider.name !== "google") return operation();
  return withLocalMailSyncBudget(
    { emailAccountId, provider: "google", priority: "backfill", cost },
    operation,
  );
}

function getPauseMs(error: unknown, provider: string) {
  if (error instanceof LocalMailSyncPausedError) return error.retryAfterMs;
  if (isEmailProviderRateLimitError({ error, provider }))
    return RATE_LIMIT_PAUSE_MS;
  return null;
}
