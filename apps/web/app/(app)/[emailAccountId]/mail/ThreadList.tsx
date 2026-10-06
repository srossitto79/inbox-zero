"use client";

import { memo, useMemo } from "react";
import { MailboxThreadList } from "@inboxzero/mail-ui/MailboxSurface";
import type { CollapsedGroupHeader } from "@inboxzero/mail-ui/MailboxSurface";
import { ThreadRow } from "@/app/(app)/[emailAccountId]/mail/ThreadRow";
import type {
  ListThread,
  MailLayoutMode,
} from "@/app/(app)/[emailAccountId]/mail/types";
import { getListThreadKey } from "@/app/(app)/[emailAccountId]/mail/types";
import { LoadingMiniSpinner } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import type { EmailLabels } from "@/providers/email-label-types";
import { useUiVariant } from "@/providers/UiPreferencesProvider";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSentMessageOpensForThreads } from "@/hooks/useSentMessageOpens";
import { cn } from "@/utils";
import { GmailLabel } from "@/utils/gmail/label";
import type { MailQueue } from "@/utils/queues";
import { QUEUE_DOT_CLASS } from "@/app/(app)/[emailAccountId]/mail/queue-grouping";

const NO_LABELS: EmailLabels = {};

export type ThreadListProps = {
  threads: ListThread[];
  emptyMessage?: string;
  layout: MailLayoutMode;
  expandedPreview: boolean;
  userEmail: string;
  userLabels: EmailLabels;
  labelsByAccount?: Record<string, EmailLabels>;
  selectionEnabled?: boolean;
  /** The row `J`/`K` sits on. */
  focusedIndex: number;
  isSelected: (threadId: string) => boolean;
  selectedCount: number;
  onOpenThread: (index: number) => void;
  onToggleSelect: (index: number) => void;
  onSelectRangeTo: (index: number) => void;
  showLoadMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  /** Identity of the current view so prefetch state does not leak across splits. */
  listKey: string;
  showSentOpenStatus?: boolean;
  /** Queue name (queues mode) or date label (timeline mode) for a thread. */
  getGroupLabel: (thread: ListThread) => string | null;
  /** Queue mode renders dot + count headers; timeline renders plain labels. */
  groupByQueue: boolean;
  /** Rule-derived queues; queue mode uses them for the header dots. */
  queues: MailQueue[];
  /** Headers of groups the user hid, positioned in the visible list. */
  collapsedHeaders: CollapsedGroupHeader[];
  /** Shows/hides a group's rows; wired to the persisted collapse state. */
  onToggleGroup: (label: string) => void;
};

export const ThreadList = memo(function ThreadList({
  threads,
  emptyMessage = "No emails in this view",
  layout,
  expandedPreview,
  userEmail,
  userLabels,
  labelsByAccount,
  selectionEnabled = true,
  focusedIndex,
  isSelected,
  selectedCount,
  onOpenThread,
  onToggleSelect,
  onSelectRangeTo,
  showLoadMore,
  isLoadingMore,
  onLoadMore,
  listKey,
  showSentOpenStatus = false,
  getGroupLabel,
  groupByQueue,
  queues,
  collapsedHeaders,
  onToggleGroup,
}: ThreadListProps) {
  const isMobile = useIsMobile();
  const isNext = useUiVariant() === "next";
  const sentThreadIds = useMemo(
    () =>
      showSentOpenStatus
        ? threads
            .filter((thread) =>
              thread.messages.at(-1)?.labelIds?.includes(GmailLabel.SENT),
            )
            .map((thread) => thread.id)
        : [],
    [showSentOpenStatus, threads],
  );
  const { data: sentMessageOpens } =
    useSentMessageOpensForThreads(sentThreadIds);
  const groupHeaderClassName = cn(
    "pt-4 pr-5 pb-1.5 text-muted-foreground",
    isNext
      ? "font-medium text-xs uppercase tracking-wide"
      : "font-normal text-sm",
    selectionEnabled ? "pl-[3.25rem]" : "pl-8",
  );

  return (
    <MailboxThreadList
      emptyMessage={emptyMessage}
      focusedIndex={focusedIndex}
      getGroupLabel={getGroupLabel}
      getKey={getListThreadKey}
      collapsedHeaders={collapsedHeaders}
      onToggleGroup={onToggleGroup}
      renderGroupHeader={
        groupByQueue
          ? ({ label, count }) => {
              const queue = queues.find(
                (candidate) => candidate.name === label,
              );
              return (
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      queue
                        ? QUEUE_DOT_CLASS[queue.colorVar]
                        : "bg-muted-foreground/40",
                    )}
                  />
                  {label}
                  <span className="font-normal">{count}</span>
                </span>
              );
            }
          : undefined
      }
      groupHeaderClassName={groupHeaderClassName}
      isLoadingMore={isLoadingMore}
      isSelected={isSelected}
      items={threads}
      listKey={listKey}
      loadMoreButton={
        <Button onClick={onLoadMore} size="sm" variant="outline">
          Load more
        </Button>
      }
      loadingMoreIndicator={
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <LoadingMiniSpinner />
          Loading more
        </div>
      }
      onLoadMore={onLoadMore}
      onOpen={onOpenThread}
      onSelectRangeTo={onSelectRangeTo}
      onToggleSelect={onToggleSelect}
      renderItem={(row) => (
        <ThreadRow
          compact={isMobile}
          expandedPreview={expandedPreview}
          hasAnySelection={row.hasAnySelection}
          index={row.index}
          isFocused={row.isFocused}
          isSelected={row.isSelected}
          key={row.rowKey}
          layout={layout}
          onOpen={row.onOpen}
          onSelectRangeTo={row.onSelectRangeTo}
          onToggleSelect={row.onToggleSelect}
          rowRef={row.rowRef}
          selectionEnabled={row.selectionEnabled}
          sentMessageOpen={
            showSentOpenStatus
              ? sentMessageOpens?.opens[row.item.messages.at(-1)?.id ?? ""]
              : undefined
          }
          thread={row.item}
          userEmail={userEmail}
          userLabels={
            "account" in row.item
              ? (labelsByAccount?.[row.item.account.id] ?? NO_LABELS)
              : userLabels
          }
        />
      )}
      selectedCount={selectedCount}
      selectionEnabled={selectionEnabled}
      showLoadMore={showLoadMore}
    />
  );
});
