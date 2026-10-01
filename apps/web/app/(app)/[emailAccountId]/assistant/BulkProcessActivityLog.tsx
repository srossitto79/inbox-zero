"use client";

import { CheckCircle2Icon, LoaderIcon } from "lucide-react";
import { Badge } from "@/components/Badge";

export type ActivityLogEntry = {
  id: string;
  from: string;
  subject: string;
  status: "processing" | "completed" | "waiting";
  ruleName?: string;
  failed?: boolean;
};

export function ActivityLog({
  entries,
  processingCount = 0,
  paused = false,
  title = "Processing Activity",
  loading = false,
}: {
  entries: ActivityLogEntry[];
  processingCount?: number;
  paused?: boolean;
  title?: string;
  loading?: boolean;
}) {
  if (entries.length === 0 && !loading) return null;

  return (
    <div className="w-full min-w-0 rounded-lg border bg-muted overflow-hidden">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {processingCount > 0 && !paused && (
          <span className="text-xs text-muted-foreground">
            {processingCount} processing
          </span>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto overflow-x-hidden">
        <div className="space-y-1 p-2">
          {entries.length === 0 && loading && (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
              <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
              Fetching emails...
            </div>
          )}
          {entries.map((entry) => (
            <ActivityLogRow key={entry.id} entry={entry} paused={paused} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ActivityLogRow({
  entry,
  paused,
}: {
  entry: ActivityLogEntry;
  paused: boolean;
}) {
  const isCompleted = entry.status === "completed";
  const showSpinner = entry.status === "processing" && !paused;

  return (
    <div className="flex items-start gap-2 rounded px-2 py-1.5 text-xs">
      {isCompleted ? (
        <CheckCircle2Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-queue-receipt" />
      ) : showSpinner ? (
        <LoaderIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin text-queue-waiting" />
      ) : (
        <div className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {entry.from}
          </span>
          <span className="flex-shrink-0">
            {entry.ruleName && (
              <Badge color={isCompleted ? "green" : "gray"}>
                {entry.ruleName}
              </Badge>
            )}
            {entry.failed && <Badge color="red">Failed</Badge>}
            {!entry.ruleName && !entry.failed && isCompleted && (
              <Badge color="yellow">No match</Badge>
            )}
          </span>
        </div>
        <div className="truncate text-muted-foreground mt-0.5">
          {entry.subject}
        </div>
      </div>
    </div>
  );
}
