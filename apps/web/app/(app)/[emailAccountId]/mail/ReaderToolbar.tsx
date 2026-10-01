"use client";

import type { ReactElement, ReactNode } from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  MailIcon,
  MailOpenIcon,
} from "lucide-react";
import {
  MailReaderToolbar,
  type MailReaderToolbarButton,
} from "@inboxzero/mail-ui/MailReaderSurface";
import { MailLabelChip } from "@/app/(app)/[emailAccountId]/mail/MailLabelChip";
import type { EmailMessageCellLabel } from "@/components/EmailMessageCellLabels";
import { Tooltip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/app/(app)/[emailAccountId]/mail/PrintButton";
import { SnoozeButton } from "@/app/(app)/[emailAccountId]/mail/SnoozeButton";
import { useUiVariant } from "@/providers/UiPreferencesProvider";

type ReaderToolbarProps = {
  subject: string;
  isStarred: boolean;
  isUnread: boolean;
  labels: EmailMessageCellLabel[];
  /**
   * Chips navigate to a label's view and nothing else: a label carries no
   * reason, because several rules — or none at all — can put one on a thread.
   * The "why" is rule-scoped and lives in `menu`.
   */
  labelHref: (labelId: string) => string;
  onRemoveLabel?: (labelId: string) => void;
  onBackToInbox: () => void;
  onArchive: () => void;
  /** Set when the thread is already archived; swaps out the Archive button. */
  onMoveToInbox?: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  /** Snoozes the open thread; the Snooze button shows in the new interface only. */
  onSnooze?: (until: Date) => void;
  onPrintMessage?: () => void;
  /** Set when the thread holds more than one message. */
  onPrintThread?: () => void;
  /** The ⋯ dropdown, i.e. `ThreadActionsMenu`, composed by the shell. */
  menu?: ReactNode;
  messageExpansion?: {
    allExpanded: boolean;
    canExpand: boolean;
    onToggleAll: () => void;
  };
  /** Place of the open thread in the list it came from. */
  position?: ReaderPosition;
};

export type ReaderPosition = {
  /** One-based. */
  current: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
};

/**
 * The reader's header: what the thread is, and what you can do to it.
 * Archive and read state stay visible; everything else lives in `menu`.
 */
export function ReaderToolbar({
  subject,
  isStarred,
  isUnread,
  labels,
  labelHref,
  onRemoveLabel,
  onBackToInbox,
  onArchive,
  onMoveToInbox,
  onMarkRead,
  onMarkUnread,
  onSnooze,
  onPrintMessage,
  onPrintThread,
  menu,
  messageExpansion,
  position,
}: ReaderToolbarProps) {
  const isNext = useUiVariant() === "next";
  return (
    <MailReaderToolbar
      icons={{
        archive: <ArchiveIcon className="size-3.5" />,
        back: <ArrowLeftIcon className="size-3.5" />,
        collapse_all: <ChevronsDownUpIcon className="size-3.5" />,
        expand_all: <ChevronsUpDownIcon className="size-3.5" />,
        mark_read: <MailOpenIcon className="size-3.5" />,
        move_to_inbox: <ArchiveRestoreIcon className="size-3.5" />,
        mark_unread: <MailIcon className="size-3.5" />,
      }}
      isStarred={isStarred}
      isUnread={isUnread}
      labelChips={labels.map((label) => (
        <MailLabelChip
          color={label.color}
          href={labelHref(label.id)}
          key={label.id}
          name={label.name}
          onRemove={onRemoveLabel ? () => onRemoveLabel(label.id) : undefined}
        />
      ))}
      extraActions={
        <>
          {isNext && onSnooze ? <SnoozeButton onSnooze={onSnooze} /> : null}
          {onPrintMessage ? (
            <PrintButton
              onPrintMessage={onPrintMessage}
              onPrintThread={onPrintThread}
            />
          ) : null}
        </>
      }
      menu={menu}
      navigation={position ? <ReaderPositionNav position={position} /> : null}
      messageExpansion={messageExpansion}
      onArchive={onArchive}
      onMoveToInbox={onMoveToInbox}
      onBackToInbox={onBackToInbox}
      onMarkRead={onMarkRead}
      onMarkUnread={onMarkUnread}
      renderActionTooltip={renderActionTooltip}
      renderButton={renderButton}
      subject={subject}
    />
  );
}

function ReaderPositionNav({ position }: { position: ReaderPosition }) {
  return (
    <div className="flex items-center gap-1">
      <span className="whitespace-nowrap text-muted-foreground text-sm tabular-nums">
        {position.current} of {position.total}
      </span>
      <Tooltip shortcuts={["previousThread"]}>
        <Button
          aria-label="Previous conversation"
          disabled={position.current <= 1}
          onClick={position.onPrevious}
          size="iconXs"
          variant="ghost"
        >
          <ChevronLeftIcon className="size-3.5" />
        </Button>
      </Tooltip>
      <Tooltip shortcuts={["nextThread"]}>
        <Button
          aria-label="Next conversation"
          disabled={position.current >= position.total}
          onClick={position.onNext}
          size="iconXs"
          variant="ghost"
        >
          <ChevronRightIcon className="size-3.5" />
        </Button>
      </Tooltip>
    </div>
  );
}

function renderButton(button: MailReaderToolbarButton) {
  return (
    <Button
      aria-label={button.ariaLabel}
      onClick={button.onClick}
      size="iconXs"
      title={button.title}
      variant={button.variant}
    >
      {button.icon}
    </Button>
  );
}

function renderActionTooltip(
  button: MailReaderToolbarButton,
  children: ReactElement,
) {
  if (button.action === "archive") {
    return <Tooltip shortcuts={["archive"]}>{children}</Tooltip>;
  }
  if (button.action === "move_to_inbox") {
    return <Tooltip content="Move to inbox">{children}</Tooltip>;
  }
  if (button.action === "mark_unread") {
    return <Tooltip shortcuts={["markUnread"]}>{children}</Tooltip>;
  }
  if (button.action === "mark_read") {
    return <Tooltip content="Mark as read">{children}</Tooltip>;
  }
  return children;
}
