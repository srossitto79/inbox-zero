import { forwardRef } from "react";
import { MailOpenIcon, SparklesIcon } from "lucide-react";
import { Logo } from "@/components/Logo";
import { BRAND_NAME } from "@/utils/branding";
import { cn } from "@/utils";

export const UnsubscribeShareCard = forwardRef<
  HTMLDivElement,
  {
    senderCount: number;
    yearlyEmails?: number | null;
    className?: string;
  }
>(function UnsubscribeShareCard({ senderCount, yearlyEmails, className }, ref) {
  const senders = senderCount === 1 ? "sender" : "senders";
  // Lead with the future emails avoided (the real win); fall back to the
  // sender count when we can't project a yearly figure.
  const hero = yearlyEmails
    ? {
        number: yearlyEmails,
        label: `fewer ${yearlyEmails === 1 ? "email" : "emails"} a year`,
        caption: `after unsubscribing from ${senderCount} ${senders}`,
      }
    : {
        number: senderCount,
        label: `${senders} unsubscribed`,
        caption: null,
      };

  return (
    <div
      ref={ref}
      className={cn(
        "relative isolate overflow-hidden rounded-2xl bg-primary px-7 py-8 text-primary-foreground shadow-lg",
        className,
      )}
    >
      {/* Decorative glow + sparkles to make the card feel celebratory */}
      <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-brand/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-12 size-52 rounded-full bg-brand/20 blur-3xl" />
      <SparklesIcon className="pointer-events-none absolute right-7 top-7 size-6 text-primary-foreground/50" />
      <SparklesIcon className="pointer-events-none absolute right-16 top-16 size-3.5 text-primary-foreground/30" />

      <Logo className="relative h-5 w-auto text-primary-foreground" />

      <div className="relative mt-7">
        <div className="bg-gradient-to-b from-primary-foreground to-primary-foreground/70 bg-clip-text text-7xl font-bold leading-none tracking-tight text-transparent tabular-nums sm:text-8xl">
          {hero.number.toLocaleString("en-US")}
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight">
          {hero.label}
        </div>
      </div>

      {hero.caption && (
        <div className="relative mt-6 inline-flex items-center gap-2 rounded-full bg-primary-foreground/15 px-3.5 py-1.5 text-sm font-medium backdrop-blur-sm">
          <MailOpenIcon className="size-4" />
          {hero.caption}
        </div>
      )}

      <div className="relative mt-7 text-sm font-medium text-primary-foreground/70">
        Cleaned up with {BRAND_NAME}
      </div>
    </div>
  );
});
