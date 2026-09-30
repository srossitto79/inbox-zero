import type { DryRunRuleResponse } from "@/app/api/user/rules/dry-run/route";

export const DRY_RUN_INITIAL_THREADS = 20;
export const DRY_RUN_MAX_THREADS = 50;
export const DRY_RUN_CONCURRENCY = 3;

export type DryRunThread = {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
};

export type DryRunEntry =
  | { status: "pending" }
  | { status: "done"; outcome: DryRunRuleResponse }
  | { status: "error"; message: string };

type MessageLike = {
  id: string;
  threadId: string;
  headers: { from: string; subject: string };
};

/** Keeps the newest message of each thread, in the order given (newest first). */
export function pickRecentThreads(
  messages: MessageLike[],
  limit: number,
): DryRunThread[] {
  const seen = new Set<string>();
  const threads: DryRunThread[] = [];

  for (const message of messages) {
    if (threads.length >= limit) break;
    if (seen.has(message.threadId)) continue;
    seen.add(message.threadId);
    threads.push({
      messageId: message.id,
      threadId: message.threadId,
      from: message.headers.from,
      subject: message.headers.subject,
    });
  }

  return threads;
}

export function summarizeDryRun(
  threads: DryRunThread[],
  entries: Record<string, DryRunEntry>,
) {
  const matched: DryRunThread[] = [];
  const leftAlone: { thread: DryRunThread; reason: string }[] = [];
  let pending = 0;
  let failed = 0;

  for (const thread of threads) {
    const entry = entries[thread.messageId];
    if (!entry || entry.status === "pending") {
      pending += 1;
    } else if (entry.status === "error") {
      failed += 1;
    } else if (entry.outcome.matched) {
      matched.push(thread);
    } else {
      leftAlone.push({ thread, reason: entry.outcome.reason });
    }
  }

  return {
    matched,
    leftAlone,
    pending,
    failed,
    checked: matched.length + leftAlone.length,
  };
}

export function hasRuleConditions(
  conditions: {
    instructions?: string | null;
    from?: string | null;
    to?: string | null;
    subject?: string | null;
    body?: string | null;
  }[],
) {
  return conditions.some(
    (condition) =>
      !!condition.instructions?.trim() ||
      !!condition.from?.trim() ||
      !!condition.to?.trim() ||
      !!condition.subject?.trim() ||
      !!condition.body?.trim(),
  );
}
