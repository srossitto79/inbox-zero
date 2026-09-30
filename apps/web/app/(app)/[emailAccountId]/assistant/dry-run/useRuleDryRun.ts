"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PQueue from "p-queue";
import type { MessagesResponse } from "@/app/api/messages/route";
import type { DryRunRuleResponse } from "@/app/api/user/rules/dry-run/route";
import type { DryRunRuleBody } from "@/app/api/user/rules/dry-run/validation";
import {
  DRY_RUN_CONCURRENCY,
  DRY_RUN_INITIAL_THREADS,
  DRY_RUN_MAX_THREADS,
  type DryRunEntry,
  type DryRunThread,
  pickRecentThreads,
} from "@/app/(app)/[emailAccountId]/assistant/dry-run/dry-run-state";
import { useAccount } from "@/providers/EmailAccountProvider";
import { fetchWithAccount } from "@/utils/fetch";

const MAX_MESSAGE_PAGES = 5;

type Status = "idle" | "loading" | "running" | "done";

export function useRuleDryRun() {
  const { emailAccountId } = useAccount();
  const [status, setStatus] = useState<Status>("idle");
  const [threads, setThreads] = useState<DryRunThread[]>([]);
  const [entries, setEntries] = useState<Record<string, DryRunEntry>>({});
  const [ranSignature, setRanSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus("done");
  }, []);

  const run = useCallback(
    async ({
      rule,
      signature,
      limit,
      append,
    }: {
      rule: DryRunRuleBody["rule"];
      signature: string;
      limit: number;
      append: boolean;
    }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      setStatus("loading");
      setRanSignature(signature);
      if (!append) setEntries({});

      try {
        const recentThreads = await fetchRecentThreads({
          emailAccountId,
          limit: Math.min(limit, DRY_RUN_MAX_THREADS),
          signal: controller.signal,
        });
        const knownIds = append
          ? new Set(threads.map((thread) => thread.messageId))
          : new Set<string>();
        const toCheck = recentThreads.filter(
          (thread) => !knownIds.has(thread.messageId),
        );

        setThreads(recentThreads);
        setEntries((previous) => {
          const next = append ? { ...previous } : {};
          for (const thread of toCheck) next[thread.messageId] = PENDING;
          return next;
        });
        setStatus("running");

        const queue = new PQueue({ concurrency: DRY_RUN_CONCURRENCY });
        for (const thread of toCheck) {
          queue.add(async () => {
            if (controller.signal.aborted) return;
            const entry = await checkThread({
              emailAccountId,
              messageId: thread.messageId,
              rule,
              signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            setEntries((previous) => ({
              ...previous,
              [thread.messageId]: entry,
            }));
          });
        }
        await queue.onIdle();
        if (!controller.signal.aborted) setStatus("done");
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof Error ? caught.message : "Dry-run could not start",
        );
        setStatus("done");
      }
    },
    [emailAccountId, threads],
  );

  const start = useCallback(
    (rule: DryRunRuleBody["rule"], signature: string) =>
      run({
        rule,
        signature,
        limit: DRY_RUN_INITIAL_THREADS,
        append: false,
      }),
    [run],
  );

  const checkMore = useCallback(
    (rule: DryRunRuleBody["rule"], signature: string) =>
      run({ rule, signature, limit: DRY_RUN_MAX_THREADS, append: true }),
    [run],
  );

  return {
    status,
    threads,
    entries,
    ranSignature,
    error,
    start,
    checkMore,
    stop,
    canCheckMore: threads.length < DRY_RUN_MAX_THREADS,
  };
}

const PENDING: DryRunEntry = { status: "pending" };

async function fetchRecentThreads({
  emailAccountId,
  limit,
  signal,
}: {
  emailAccountId: string;
  limit: number;
  signal: AbortSignal;
}) {
  const messages: MessagesResponse["messages"] = [];
  let pageToken: string | null | undefined;

  for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
    const params = new URLSearchParams();
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetchWithAccount({
      url: `/api/messages${params.size ? `?${params}` : ""}`,
      emailAccountId,
      init: { signal },
    });
    if (!response.ok) throw new Error("Recent threads could not be loaded");

    const data: MessagesResponse = await response.json();
    messages.push(...data.messages);
    pageToken = data.nextPageToken;

    if (pickRecentThreads(messages, limit).length >= limit || !pageToken) break;
  }

  return pickRecentThreads(messages, limit);
}

async function checkThread({
  emailAccountId,
  messageId,
  rule,
  signal,
}: {
  emailAccountId: string;
  messageId: string;
  rule: DryRunRuleBody["rule"];
  signal: AbortSignal;
}): Promise<DryRunEntry> {
  try {
    const response = await fetchWithAccount({
      url: "/api/user/rules/dry-run",
      emailAccountId,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, rule } satisfies DryRunRuleBody),
        signal,
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return {
        status: "error",
        message: body?.error || "Could not check this thread",
      };
    }
    const outcome: DryRunRuleResponse = await response.json();
    return { status: "done", outcome };
  } catch {
    return { status: "error", message: "Could not check this thread" };
  }
}
