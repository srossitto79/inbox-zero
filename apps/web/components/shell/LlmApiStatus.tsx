"use client";

import { useLlmStatus } from "@/hooks/useLlmStatus";
import { cn } from "@/utils";
import type { LlmStatus } from "@/app/api/user/llm-status/llm-status";

const LABELS: Record<LlmStatus, string> = {
  online: "LLM API online",
  unreachable: "LLM API unreachable",
  configured: "LLM API configured",
  not_configured: "LLM API not configured",
};

const DOT_CLASSES: Record<LlmStatus, string> = {
  online: "bg-brand",
  configured: "bg-brand",
  unreachable: "bg-destructive",
  not_configured: "bg-muted-foreground/40",
};

export function LlmApiStatus() {
  const { data } = useLlmStatus();
  if (!data) return null;

  const detail = [data.model, data.latencyMs !== null && `${data.latencyMs} ms`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="flex items-start gap-2 px-2 py-1.5 text-xs text-muted-foreground"
      title={[data.provider, detail].filter(Boolean).join(" · ") || undefined}
    >
      <span
        className={cn(
          "mt-1 size-2 shrink-0 rounded-full",
          DOT_CLASSES[data.status],
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="truncate text-foreground">{LABELS[data.status]}</div>
        {detail ? <div className="truncate">{detail}</div> : null}
      </div>
    </div>
  );
}
