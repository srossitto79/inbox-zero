"use client";

import Link from "next/link";
import { WorkflowIcon } from "lucide-react";
import { useExecutedRules } from "@/hooks/useExecutedRules";
import { useAccount } from "@/providers/EmailAccountProvider";
import { prefixPath } from "@/utils/path";

/**
 * Says which rule acted on the thread. It renders nothing until a recorded
 * execution exists, so a thread no rule touched shows no strip.
 */
export function ExecutedRuleStrip({ threadId }: { threadId: string }) {
  const { emailAccountId } = useAccount();
  const { data } = useExecutedRules({ page: 1, ruleId: "all", threadId });

  const executed = data?.results
    .flatMap((message) => message.executedRules)
    .find((item) => item.rule);
  if (!executed?.rule) return null;

  const { rule } = executed;

  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-2xl border border-border bg-muted/50 px-4 py-3"
      data-testid="executed-rule-strip"
    >
      <WorkflowIcon className="mt-0.5 size-4 shrink-0 text-brand" />
      <div className="min-w-0 flex-1 text-foreground text-sm leading-snug">
        <span className="font-semibold">Filed under {rule.name}.</span>{" "}
        {executed.reason ? (
          <span className="text-muted-foreground">{executed.reason}</span>
        ) : null}
      </div>
      <Link
        className="shrink-0 font-medium text-brand text-sm hover:underline"
        href={prefixPath(emailAccountId, `/assistant/rule/${rule.id}`)}
      >
        View rule
      </Link>
    </div>
  );
}
