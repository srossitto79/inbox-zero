import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";

export const MAILBOX_PREFETCH_REMAINING = 8;
export const MAILBOX_SCROLL_PADDING_PX = 8;
export const MAILBOX_LOAD_MORE_ROOT_MARGIN = "400px 0px";
const EMPTY_COLLAPSED_HEADERS: CollapsedGroupHeader[] = [];

export type MailboxThreadListRenderInput<T> = {
  item: T;
  index: number;
  rowKey: string;
  isFocused: boolean;
  isSelected: boolean;
  hasAnySelection: boolean;
  selectionEnabled: boolean;
  rowRef?: Ref<HTMLDivElement>;
  onOpen: (index: number) => void;
  onToggleSelect: (index: number) => void;
  onSelectRangeTo: (index: number) => void;
};

export type MailboxGroup<T> = {
  label: string | null;
  startIndex: number;
  items: T[];
};

/**
 * A group whose rows are hidden: `beforeIndex` is how many visible items
 * precede it, so the header can be interleaved between the groups that remain.
 */
export type CollapsedGroupHeader = {
  label: string;
  count: number;
  beforeIndex: number;
};

export type MailboxGroupSection<T> =
  | { type: "group"; group: MailboxGroup<T> }
  | { type: "collapsedHeader"; header: CollapsedGroupHeader };

export type MailboxThreadListProps<T> = {
  items: T[];
  getKey: (item: T) => string;
  getGroupLabel?: (item: T) => string | null;
  /** Replaces the plain label header; always rendered for labelled groups. */
  renderGroupHeader?: (group: { label: string; count: number }) => ReactNode;
  /** Headers for groups whose rows were filtered out, with their positions. */
  collapsedHeaders?: CollapsedGroupHeader[];
  /** Toggles a group's rows; when set, headers become expand/collapse buttons. */
  onToggleGroup?: (label: string) => void;
  renderItem: (input: MailboxThreadListRenderInput<T>) => ReactNode;
  emptyMessage?: string;
  selectionEnabled?: boolean;
  focusedIndex: number;
  isSelected: (key: string) => boolean;
  selectedCount: number;
  onOpen: (index: number) => void;
  onToggleSelect: (index: number) => void;
  onSelectRangeTo: (index: number) => void;
  showLoadMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  listKey: string;
  className?: string;
  scrollClassName?: string;
  listClassName?: string;
  groupHeaderClassName?: string;
  loadMoreClassName?: string;
  emptyClassName?: string;
  style?: CSSProperties;
  scrollStyle?: CSSProperties;
  listStyle?: CSSProperties;
  loadMoreStyle?: CSSProperties;
  emptyStyle?: CSSProperties;
  loadingMoreIndicator?: ReactNode;
  loadMoreButton?: ReactNode;
};

export function MailboxThreadList<T>({
  items,
  getKey,
  getGroupLabel = () => null,
  renderGroupHeader,
  collapsedHeaders = EMPTY_COLLAPSED_HEADERS,
  onToggleGroup,
  renderItem,
  emptyMessage = "No emails in this view",
  selectionEnabled = true,
  focusedIndex,
  isSelected,
  selectedCount,
  onOpen,
  onToggleSelect,
  onSelectRangeTo,
  showLoadMore,
  isLoadingMore,
  onLoadMore,
  listKey,
  className = "flex min-h-0 flex-1 flex-col overflow-hidden",
  scrollClassName = "min-h-0 flex-1 overflow-y-auto overflow-x-hidden",
  listClassName,
  groupHeaderClassName = "pt-4 pr-5 pb-1.5 font-normal text-muted-foreground text-sm",
  loadMoreClassName = "flex justify-center px-4 py-5",
  emptyClassName = "px-6 py-12 text-center text-muted-foreground text-sm",
  style,
  scrollStyle,
  listStyle,
  loadMoreStyle,
  emptyStyle,
  loadingMoreIndicator = "Loading more",
  loadMoreButton,
}: MailboxThreadListProps<T>) {
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const focusedRowRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const prefetchForCount = useRef<number | null>(null);
  const prefetchListKey = useRef(listKey);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  const focusedKey = items[focusedIndex]
    ? getKey(items[focusedIndex])
    : undefined;
  const groups = useMemo(
    () => groupItemsByLabel(items, getGroupLabel),
    [items, getGroupLabel],
  );
  const sections = useMemo(
    () => mergeGroupSections(groups, collapsedHeaders),
    [groups, collapsedHeaders],
  );

  const renderHeader = ({
    label,
    count,
    expanded,
  }: {
    label: string;
    count: number;
    expanded: boolean;
  }) => {
    const content = renderGroupHeader
      ? renderGroupHeader({ label, count })
      : // The Today heading stays suppressed to match the plain date headers;
        // without text there is nothing to anchor a toggle to.
        label !== "Today"
        ? label
        : null;

    if (content === null || content === undefined) return null;

    if (!onToggleGroup) {
      return (
        <div aria-hidden className={groupHeaderClassName}>
          {content}
        </div>
      );
    }

    return (
      <button
        aria-expanded={expanded}
        className={`${groupHeaderClassName} relative w-full cursor-pointer text-left transition-colors hover:text-foreground`}
        onClick={() => onToggleGroup(label)}
        type="button"
      >
        <svg
          aria-hidden="true"
          className={`absolute left-1.5 top-[1.5rem] size-3.5 -translate-y-1/2 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            d="m9 18 6-6-6-6"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
          />
        </svg>
        {content}
      </button>
    );
  };

  useLayoutEffect(() => {
    if (!scrollRoot || focusedIndex < 0 || !focusedKey) return;
    const row = focusedRowRef.current;
    if (!row) return;
    scrollElementIntoContainer(scrollRoot, row);
  }, [focusedIndex, focusedKey, scrollRoot]);

  useEffect(() => {
    if (prefetchListKey.current !== listKey) {
      prefetchListKey.current = listKey;
      prefetchForCount.current = null;
    }
    if (
      !shouldPrefetchMoreItems({
        hasMore: showLoadMore,
        isLoadingMore,
        focusedIndex,
        itemCount: items.length,
      })
    ) {
      return;
    }
    if (prefetchForCount.current === items.length) return;
    prefetchForCount.current = items.length;
    onLoadMoreRef.current();
  }, [focusedIndex, isLoadingMore, listKey, showLoadMore, items.length]);

  useEffect(() => {
    if (!showLoadMore || !scrollRoot || items.length === 0) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMoreRef.current();
        }
      },
      { root: scrollRoot, rootMargin: MAILBOX_LOAD_MORE_ROOT_MARGIN },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [scrollRoot, showLoadMore, items.length]);

  return (
    <div className={className} style={style}>
      <div className={scrollClassName} ref={setScrollRoot} style={scrollStyle}>
        {items.length === 0 &&
        collapsedHeaders.length === 0 &&
        !showLoadMore ? (
          <div className={emptyClassName} style={emptyStyle}>
            {emptyMessage}
          </div>
        ) : (
          <>
            <div
              aria-label="Conversations"
              aria-multiselectable={selectionEnabled || undefined}
              className={listClassName}
              role="listbox"
              style={listStyle}
            >
              {sections.map((section, sectionIndex) =>
                section.type === "collapsedHeader" ? (
                  <div
                    aria-label={section.header.label}
                    key={`collapsed-${sectionIndex}-${section.header.label}`}
                    role="group"
                  >
                    {renderHeader({
                      label: section.header.label,
                      count: section.header.count,
                      expanded: false,
                    })}
                  </div>
                ) : (
                  <div
                    aria-label={section.group.label ?? undefined}
                    key={`${section.group.label ?? "ungrouped"}-${section.group.startIndex}`}
                    role="group"
                  >
                    {section.group.label
                      ? renderHeader({
                          label: section.group.label,
                          count: section.group.items.length,
                          expanded: true,
                        })
                      : null}
                    {section.group.items.map((item, offset) => {
                      const index = section.group.startIndex + offset;
                      const rowKey = getKey(item);
                      return renderItem({
                        item,
                        index,
                        rowKey,
                        isFocused: index === focusedIndex,
                        isSelected: selectionEnabled && isSelected(rowKey),
                        hasAnySelection: selectionEnabled && selectedCount > 0,
                        selectionEnabled,
                        rowRef:
                          index === focusedIndex ? focusedRowRef : undefined,
                        onOpen,
                        onToggleSelect,
                        onSelectRangeTo,
                      });
                    })}
                  </div>
                ),
              )}
            </div>

            {showLoadMore ? (
              <div
                className={loadMoreClassName}
                ref={sentinelRef}
                style={loadMoreStyle}
              >
                {isLoadingMore ? (
                  <div aria-live="polite" role="status">
                    {loadingMoreIndicator}
                  </div>
                ) : (
                  (loadMoreButton ?? (
                    <button onClick={onLoadMore} type="button">
                      Load more
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export type MailReaderPaneProps = {
  selected: boolean;
  children: ReactNode;
  empty?: ReactNode;
  loading?: boolean;
  error?: ReactNode;
  className?: string;
  style?: CSSProperties;
  bodyClassName?: string;
  bodyStyle?: CSSProperties;
};

export function MailReaderPane({
  selected,
  children,
  empty = "Select an email to read it.",
  loading = false,
  error,
  className,
  style,
  bodyClassName,
  bodyStyle,
}: MailReaderPaneProps) {
  return (
    <section aria-label="Reader" className={className} style={style}>
      {!selected ? (
        <div className={bodyClassName} style={bodyStyle}>
          {empty}
        </div>
      ) : loading ? (
        <div className={bodyClassName} style={bodyStyle}>
          Loading…
        </div>
      ) : error ? (
        <div className={bodyClassName} style={bodyStyle}>
          {error}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

export function shouldPrefetchMoreItems({
  hasMore,
  isLoadingMore,
  focusedIndex,
  itemCount,
  remainingThreshold = MAILBOX_PREFETCH_REMAINING,
}: {
  hasMore: boolean;
  isLoadingMore: boolean;
  focusedIndex: number;
  itemCount: number;
  remainingThreshold?: number;
}): boolean {
  if (!hasMore || isLoadingMore || itemCount === 0) return false;
  return focusedIndex >= itemCount - remainingThreshold;
}

export function scrollElementIntoContainer(
  container: HTMLElement,
  element: HTMLElement,
  padding = MAILBOX_SCROLL_PADDING_PX,
): void {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  const topOverflow = containerRect.top + padding - elementRect.top;
  const bottomOverflow = elementRect.bottom - (containerRect.bottom - padding);

  if (topOverflow > 0) {
    container.scrollTop -= topOverflow;
  } else if (bottomOverflow > 0) {
    container.scrollTop += bottomOverflow;
  }
}

function groupItemsByLabel<T>(
  items: T[],
  getGroupLabel: (item: T) => string | null,
) {
  const groups: MailboxGroup<T>[] = [];

  items.forEach((item, index) => {
    const label = getGroupLabel(item);
    const openGroup = groups.at(-1);
    if (openGroup?.label === label) openGroup.items.push(item);
    else groups.push({ label, startIndex: index, items: [item] });
  });

  return groups;
}

/**
 * Merges the headers of collapsed groups (whose rows were filtered out) back
 * into the visible groups, ordered by position: each collapsed header sits
 * before the first visible item that followed it in the full list.
 */
export function mergeGroupSections<T>(
  groups: MailboxGroup<T>[],
  collapsedHeaders: CollapsedGroupHeader[],
): MailboxGroupSection<T>[] {
  const sections: MailboxGroupSection<T>[] = [];
  let pending = 0;

  for (const group of groups) {
    while (
      pending < collapsedHeaders.length &&
      collapsedHeaders[pending].beforeIndex <= group.startIndex
    ) {
      sections.push({
        type: "collapsedHeader",
        header: collapsedHeaders[pending],
      });
      pending++;
    }
    sections.push({ type: "group", group });
  }
  while (pending < collapsedHeaders.length) {
    sections.push({
      type: "collapsedHeader",
      header: collapsedHeaders[pending],
    });
    pending++;
  }

  return sections;
}
