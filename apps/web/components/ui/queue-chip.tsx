import type * as React from "react";
import { cn } from "@/utils";

export type QueueKey =
  | "reply"
  | "waiting"
  | "fyi"
  | "newsletter"
  | "receipt"
  | "calendar";

// Literal class strings so Tailwind can see them. Light text is mixed toward the
// foreground for contrast; dark mode uses the (already light) queue token.
export const queueChipClasses: Record<QueueKey, string> = {
  reply:
    "bg-queue-reply/15 text-[color-mix(in_srgb,hsl(var(--queue-reply))_70%,hsl(var(--foreground)))] dark:bg-queue-reply/20 dark:text-queue-reply",
  waiting:
    "bg-queue-waiting/15 text-[color-mix(in_srgb,hsl(var(--queue-waiting))_70%,hsl(var(--foreground)))] dark:bg-queue-waiting/20 dark:text-queue-waiting",
  fyi: "bg-queue-fyi/15 text-[color-mix(in_srgb,hsl(var(--queue-fyi))_70%,hsl(var(--foreground)))] dark:bg-queue-fyi/20 dark:text-queue-fyi",
  newsletter:
    "bg-queue-newsletter/15 text-[color-mix(in_srgb,hsl(var(--queue-newsletter))_70%,hsl(var(--foreground)))] dark:bg-queue-newsletter/20 dark:text-queue-newsletter",
  receipt:
    "bg-queue-receipt/15 text-[color-mix(in_srgb,hsl(var(--queue-receipt))_70%,hsl(var(--foreground)))] dark:bg-queue-receipt/20 dark:text-queue-receipt",
  calendar:
    "bg-queue-calendar/15 text-[color-mix(in_srgb,hsl(var(--queue-calendar))_70%,hsl(var(--foreground)))] dark:bg-queue-calendar/20 dark:text-queue-calendar",
};

export const queueDotClasses: Record<QueueKey, string> = {
  reply: "bg-queue-reply",
  waiting: "bg-queue-waiting",
  fyi: "bg-queue-fyi",
  newsletter: "bg-queue-newsletter",
  receipt: "bg-queue-receipt",
  calendar: "bg-queue-calendar",
};

export function QueueChip({
  queue,
  dot = true,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  queue: QueueKey;
  /** Show the leading colored dot. */
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        queueChipClasses[queue],
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", queueDotClasses[queue])}
        />
      )}
      {children}
    </span>
  );
}
