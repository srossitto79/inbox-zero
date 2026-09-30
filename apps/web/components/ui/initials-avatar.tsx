import { cn } from "@/utils";

// Literal class strings so Tailwind can see them.
const TINTS = [
  "bg-queue-reply/15 text-[color-mix(in_srgb,hsl(var(--queue-reply))_70%,hsl(var(--foreground)))] dark:bg-queue-reply/20 dark:text-queue-reply",
  "bg-queue-waiting/15 text-[color-mix(in_srgb,hsl(var(--queue-waiting))_70%,hsl(var(--foreground)))] dark:bg-queue-waiting/20 dark:text-queue-waiting",
  "bg-queue-newsletter/15 text-[color-mix(in_srgb,hsl(var(--queue-newsletter))_70%,hsl(var(--foreground)))] dark:bg-queue-newsletter/20 dark:text-queue-newsletter",
  "bg-queue-receipt/15 text-[color-mix(in_srgb,hsl(var(--queue-receipt))_70%,hsl(var(--foreground)))] dark:bg-queue-receipt/20 dark:text-queue-receipt",
  "bg-queue-calendar/15 text-[color-mix(in_srgb,hsl(var(--queue-calendar))_70%,hsl(var(--foreground)))] dark:bg-queue-calendar/20 dark:text-queue-calendar",
  "bg-brand/15 text-foreground",
] as const;

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-11 text-sm",
} as const;

function hash(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function getInitials(name: string) {
  const parts = name
    .replace(/<.*?>/g, "")
    .replace(/["']/g, "")
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0];
  const second = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + second).toUpperCase();
}

/** Round avatar with initials and a tint chosen deterministically from `name`. */
export function InitialsAvatar({
  name,
  seed,
  size = "md",
  className,
}: {
  name: string;
  /** Overrides what the color is derived from (for example the email address). */
  seed?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const tint = TINTS[hash((seed ?? name).toLowerCase()) % TINTS.length];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold",
        SIZES[size],
        tint,
        className,
      )}
    >
      {getInitials(name)}
    </span>
  );
}
