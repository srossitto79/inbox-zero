import type * as React from "react";
import { cn } from "@/utils";

export function StatTile({
  value,
  label,
  hint,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "children"> & {
  value: React.ReactNode;
  label: React.ReactNode;
  /** Optional small line under the label. */
  hint?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-4 text-card-foreground shadow-sm",
        className,
      )}
      {...props}
    >
      <div className="font-display text-3xl font-semibold leading-none tracking-tight tabular-nums">
        {value}
      </div>
      <div className="mt-2 text-sm text-muted-foreground">{label}</div>
      {hint ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}
