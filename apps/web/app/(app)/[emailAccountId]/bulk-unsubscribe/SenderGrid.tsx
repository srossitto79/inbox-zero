"use client";

import { ArchiveIcon, CheckIcon, ThumbsUpIcon } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import type { NewsletterStatsResponse } from "@/app/api/user/stats/newsletters/route";
import {
  MoreDropdown,
  UnsubscribeButton,
} from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/common";
import {
  useApproveButton,
  useBulkArchive,
} from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/hooks";
import { isUnsubscribeSuggestion } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/suggestions";
import type { NewsletterFilterType } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/types";
import { ButtonCheckbox } from "@/components/ButtonCheckbox";
import { ButtonLoader } from "@/components/Loading";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { UserResponse } from "@/app/api/user/me/route";
import type { EmailLabel } from "@/providers/email-label-types";
import { NewsletterStatus } from "@/generated/prisma/enums";
import { extractNameFromEmail } from "@/utils/email";
import { cn } from "@/utils";

type Newsletter = NewsletterStatsResponse["newsletters"][number];

type SenderKind = {
  label: string;
  variant: NonNullable<BadgeProps["variant"]>;
};

const AVATAR_STYLES = [
  "bg-queue-reply/15 text-queue-reply",
  "bg-queue-waiting/15 text-queue-waiting",
  "bg-queue-newsletter/15 text-queue-newsletter",
  "bg-queue-receipt/15 text-queue-receipt",
  "bg-queue-calendar/15 text-queue-calendar",
  "bg-queue-fyi/15 text-queue-fyi",
];

export function SenderGrid({
  rows,
  selected,
  selectedRowName,
  onToggleSelect,
  onSelectRow,
  onOpenNewsletter,
  userEmail,
  emailAccountId,
  labels,
  mutate,
  hasUnsubscribeAccess,
  refetchPremium,
  openPremiumModal,
  filter,
}: {
  rows: Newsletter[];
  selected: ReadonlyMap<string, boolean>;
  selectedRowName?: string;
  onToggleSelect: (id: string, shiftKey?: boolean) => void;
  onSelectRow: (item: Newsletter) => void;
  onOpenNewsletter: (item: Newsletter) => void;
  userEmail: string;
  emailAccountId: string;
  labels: EmailLabel[];
  mutate: () => Promise<unknown>;
  hasUnsubscribeAccess: boolean;
  refetchPremium: () => Promise<UserResponse | null | undefined>;
  openPremiumModal: () => void;
  filter: NewsletterFilterType;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((item) => (
        <SenderTile
          key={item.name}
          item={item}
          checked={selected.get(item.name) || false}
          highlighted={selectedRowName === item.name}
          onToggleSelect={onToggleSelect}
          onSelectRow={onSelectRow}
          onOpenNewsletter={onOpenNewsletter}
          userEmail={userEmail}
          emailAccountId={emailAccountId}
          labels={labels}
          mutate={mutate}
          hasUnsubscribeAccess={hasUnsubscribeAccess}
          refetchPremium={refetchPremium}
          openPremiumModal={openPremiumModal}
          filter={filter}
        />
      ))}
    </div>
  );
}

function SenderTile({
  item,
  checked,
  highlighted,
  onToggleSelect,
  onSelectRow,
  onOpenNewsletter,
  userEmail,
  emailAccountId,
  labels,
  mutate,
  hasUnsubscribeAccess,
  refetchPremium,
  openPremiumModal,
  filter,
}: {
  item: Newsletter;
  checked: boolean;
  highlighted: boolean;
  onToggleSelect: (id: string, shiftKey?: boolean) => void;
  onSelectRow: (item: Newsletter) => void;
  onOpenNewsletter: (item: Newsletter) => void;
  userEmail: string;
  emailAccountId: string;
  labels: EmailLabel[];
  mutate: () => Promise<unknown>;
  hasUnsubscribeAccess: boolean;
  refetchPremium: () => Promise<UserResponse | null | undefined>;
  openPremiumModal: () => void;
  filter: NewsletterFilterType;
}) {
  const posthog = usePostHog();
  const displayName = item.fromName || extractNameFromEmail(item.name);
  const readPercentage =
    item.value > 0 ? (item.readEmails / item.value) * 100 : 0;
  const isSuggested = isUnsubscribeSuggestion(item);
  const kind = getSenderKind(item);

  const { onApprove, isApproved } = useApproveButton({
    item,
    mutate: mutate as () => Promise<void>,
    posthog,
    emailAccountId,
    filter,
  });
  const { onBulkArchive, isBulkArchiving } = useBulkArchive({
    posthog,
    emailAccountId,
    mutate,
  });

  return (
    <div
      data-selected={highlighted || undefined}
      onMouseEnter={() => onSelectRow(item)}
      onDoubleClick={() => onOpenNewsletter(item)}
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-card p-4",
        checked ? "border-brand" : "border-border",
        highlighted && !checked && "border-foreground/20",
      )}
    >
      <div className="flex items-center gap-3">
        <ButtonCheckbox
          label={`Select ${displayName}`}
          checked={checked}
          onChange={(shiftKey) => onToggleSelect(item.name, shiftKey)}
        />
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
            getAvatarStyle(item.name),
          )}
          aria-hidden
        >
          {getInitials(displayName)}
        </div>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onOpenNewsletter(item)}
        >
          <div className="truncate text-sm font-semibold">{displayName}</div>
          <div className="truncate text-xs text-muted-foreground">
            {item.name}
          </div>
        </button>
        <Badge variant={kind.variant} className="shrink-0">
          {kind.label}
        </Badge>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{item.value.toLocaleString()} emails</span>
          <span>{Math.round(readPercentage)}% read</span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Read"
          aria-valuenow={Math.round(readPercentage)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn(
              "h-full rounded-full",
              isSuggested ? "bg-queue-reply" : "bg-brand",
            )}
            style={{ width: `${Math.max(readPercentage, 3)}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={isApproved ? "secondary" : "outline"}
          onClick={onApprove}
          disabled={!hasUnsubscribeAccess}
          aria-pressed={isApproved}
        >
          {isApproved ? (
            <CheckIcon className="size-4" />
          ) : (
            <ThumbsUpIcon className="size-4" />
          )}
          Keep
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onBulkArchive([item])}
          disabled={isBulkArchiving}
        >
          {isBulkArchiving ? (
            <ButtonLoader />
          ) : (
            <ArchiveIcon className="size-4" />
          )}
          Archive all
        </Button>
        <UnsubscribeButton
          item={item}
          hasUnsubscribeAccess={hasUnsubscribeAccess}
          mutate={mutate as () => Promise<void>}
          posthog={posthog}
          refetchPremium={refetchPremium}
          emailAccountId={emailAccountId}
          className="justify-center"
        />
        <div className="ml-auto">
          <MoreDropdown
            onOpenNewsletter={onOpenNewsletter}
            item={item}
            userEmail={userEmail}
            emailAccountId={emailAccountId}
            labels={labels}
            posthog={posthog}
            mutate={mutate}
            hasUnsubscribeAccess={hasUnsubscribeAccess}
            refetchPremium={refetchPremium}
            filter={filter}
            openPremiumModal={openPremiumModal}
          />
        </div>
      </div>
    </div>
  );
}

function getSenderKind(item: Newsletter): SenderKind {
  if (item.status === NewsletterStatus.UNSUBSCRIBED)
    return { label: "Unsubscribed", variant: "calendar" };
  if (item.autoArchived) return { label: "Auto archive", variant: "fyi" };
  if (item.status === NewsletterStatus.APPROVED)
    return { label: "Approved", variant: "receipt" };
  if (item.unsubscribeLink)
    return { label: "Newsletter", variant: "newsletter" };
  return { label: "Sender", variant: "muted" };
}

function getInitials(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/);
  const letters = words
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("");
  return (letters || name.slice(0, 2)).toUpperCase();
}

function getAvatarStyle(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_STYLES[hash % AVATAR_STYLES.length];
}
