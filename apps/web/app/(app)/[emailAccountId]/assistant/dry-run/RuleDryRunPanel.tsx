"use client";

import { FlaskConicalIcon, PauseIcon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils";
import { extractNameFromEmail } from "@/utils/email";
import type { DryRunRuleBody } from "@/app/api/user/rules/dry-run/validation";
import {
  type DryRunThread,
  summarizeDryRun,
} from "@/app/(app)/[emailAccountId]/assistant/dry-run/dry-run-state";
import { useRuleDryRun } from "@/app/(app)/[emailAccountId]/assistant/dry-run/useRuleDryRun";

const VISIBLE_ROWS = 8;

export function RuleDryRunPanel({
  rule,
  canRun,
  className,
}: {
  rule: DryRunRuleBody["rule"];
  canRun: boolean;
  className?: string;
}) {
  const dryRun = useRuleDryRun();
  const signature = JSON.stringify(rule);
  const summary = summarizeDryRun(dryRun.threads, dryRun.entries);
  const isBusy = dryRun.status === "loading" || dryRun.status === "running";
  const hasResults = dryRun.ranSignature !== null;
  const isOutdated = hasResults && dryRun.ranSignature !== signature;

  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Dry-run
        </h2>
        <div className="flex items-center gap-2">
          {hasResults && (
            <span className="rounded-full bg-queue-newsletter/15 px-2.5 py-0.5 text-xs font-medium text-queue-newsletter">
              {summary.matched.length} of {dryRun.threads.length} threads would
              match
            </span>
          )}
          {isBusy ? (
            <Button
              variant="outline"
              size="sm"
              Icon={PauseIcon}
              onClick={dryRun.stop}
            >
              Stop
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              Icon={hasResults ? PlayIcon : FlaskConicalIcon}
              disabled={!canRun}
              onClick={() => dryRun.start(rule, signature)}
            >
              {hasResults ? "Run again" : "Run dry-run"}
            </Button>
          )}
        </div>
      </div>

      {dryRun.error && (
        <p className="text-sm text-destructive" role="alert">
          {dryRun.error}
        </p>
      )}

      {isOutdated && !isBusy && (
        <p className="text-sm text-muted-foreground">
          Rule changed since the last run.
        </p>
      )}

      {hasResults && (
        <>
          <ThreadList
            rows={summary.matched.map((thread) => ({
              thread,
              badge: "Matches",
              badgeClassName: "bg-queue-receipt/15 text-queue-receipt",
            }))}
            emptyLabel={isBusy ? "Checking" : "No matches"}
          />

          {summary.leftAlone.length > 0 && (
            <>
              <h3 className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Left alone
              </h3>
              <ThreadList
                title="Left alone"
                rows={summary.leftAlone.map(({ thread, reason }) => ({
                  thread,
                  badge: reason,
                  badgeClassName: "bg-muted text-muted-foreground",
                }))}
                emptyLabel=""
              />
            </>
          )}

          {summary.failed > 0 && (
            <p className="text-sm text-muted-foreground">
              {summary.failed} {summary.failed === 1 ? "thread" : "threads"}{" "}
              could not be checked.
            </p>
          )}

          {dryRun.status === "done" && dryRun.canCheckMore && (
            <Button
              variant="ghost"
              size="sm"
              disabled={isOutdated}
              onClick={() => dryRun.checkMore(rule, signature)}
            >
              Check more threads
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function ThreadList({
  title,
  rows,
  emptyLabel,
}: {
  title?: string;
  rows: {
    thread: DryRunThread;
    badge: string;
    badgeClassName: string;
  }[];
  emptyLabel: string;
}) {
  if (!rows.length) {
    return emptyLabel ? (
      <p className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    ) : null;
  }

  const visibleRows = rows.slice(0, VISIBLE_ROWS);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <ul
      className="overflow-hidden rounded-2xl border border-border bg-card"
      aria-label={title}
    >
      {visibleRows.map(({ thread, badge, badgeClassName }) => (
        <li
          key={thread.messageId}
          className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
        >
          <span
            aria-hidden
            className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
          >
            {getInitials(thread.from)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {extractNameFromEmail(thread.from)}
            </div>
            <div className="truncate text-sm text-muted-foreground">
              {thread.subject}
            </div>
          </div>
          <span
            className={cn(
              "max-w-[45%] shrink-0 truncate rounded-full px-2.5 py-0.5 text-xs font-medium",
              badgeClassName,
            )}
            title={badge}
          >
            {badge}
          </span>
        </li>
      ))}
      {hiddenCount > 0 && (
        <li className="bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
          and {hiddenCount} more
        </li>
      )}
    </ul>
  );
}

function getInitials(from: string) {
  const name = extractNameFromEmail(from).trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return (initials || "?").toUpperCase();
}
