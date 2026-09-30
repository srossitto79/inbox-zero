import { cn } from "@/utils";

const TONES = [
  "bg-[hsl(var(--queue-reply)/0.14)] text-queue-reply",
  "bg-[hsl(var(--queue-waiting)/0.14)] text-queue-waiting",
  "bg-[hsl(var(--queue-newsletter)/0.14)] text-queue-newsletter",
  "bg-[hsl(var(--queue-receipt)/0.14)] text-queue-receipt",
  "bg-[hsl(var(--queue-calendar)/0.14)] text-queue-calendar",
  "bg-muted text-muted-foreground",
] as const;

/** Colored initials; the color follows the name so a sender looks the same everywhere. */
export function SenderAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const initials = getInitials(name);

  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 select-none items-center justify-center rounded-full font-medium text-xs",
        TONES[hashName(name) % TONES.length],
        className,
      )}
    >
      {initials}
    </span>
  );
}

function getInitials(name: string) {
  const words = name
    .replace(/<.*>/, "")
    .split(/[\s,.@]+/)
    .filter(Boolean);
  const first = words[0]?.at(0) ?? "?";
  const second = words.length > 1 ? (words.at(-1)?.at(0) ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

function hashName(name: string) {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) % 0xff_ff_ff;
  }
  return hash;
}
