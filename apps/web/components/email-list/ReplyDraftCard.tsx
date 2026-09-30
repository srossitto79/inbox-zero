"use client";

import type { ReactNode } from "react";
import { SparklesIcon } from "lucide-react";
import { useExecutedRules } from "@/hooks/useExecutedRules";
import { ActionType } from "@/generated/prisma/enums";
import { useUiVariant } from "@/providers/UiPreferencesProvider";

/**
 * Frames a saved reply draft. The composer inside keeps its own Send, Edit and
 * discard controls; the card only names where the draft came from.
 */
export function ReplyDraftCard({
  threadId,
  children,
}: {
  threadId: string;
  children: ReactNode;
}) {
  const isNext = useUiVariant() === "next";
  const { data } = useExecutedRules({ page: 1, ruleId: "all", threadId });

  if (!isNext) return children;

  const isAiDraft = Boolean(
    data?.results.some((message) =>
      message.executedRules.some((executed) =>
        executed.actionItems.some(
          (item) => item.type === ActionType.DRAFT_EMAIL,
        ),
      ),
    ),
  );

  return (
    <section className="mt-5 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 font-semibold text-brand text-xs uppercase tracking-wide">
        <SparklesIcon className="size-4" />
        {isAiDraft ? "Draft in your voice" : "Draft"}
      </div>
      {children}
    </section>
  );
}
