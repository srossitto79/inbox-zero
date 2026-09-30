"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { subDays } from "date-fns/subDays";
import { ChevronDown } from "lucide-react";
import { useLocalStorage } from "usehooks-ts";
import { usePostHog } from "posthog-js/react";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronsDownIcon,
  ChevronsUpIcon,
  InboxIcon,
  LayoutGridIcon,
  ListIcon,
  MailXIcon,
  SparklesIcon,
  ThumbsUpIcon,
} from "lucide-react";
import type { DateRange } from "react-day-picker";
import { LoadingContent } from "@/components/LoadingContent";
import type {
  NewsletterStatsQuery,
  NewsletterStatsResponse,
} from "@/app/api/user/stats/newsletters/route";
import { getDateRangeParams } from "@/app/(app)/[emailAccountId]/stats/params";
import { NewsletterModal } from "@/app/(app)/[emailAccountId]/stats/NewsletterModal";
import { useEmailsToIncludeFilter } from "@/app/(app)/[emailAccountId]/stats/EmailsToIncludeFilter";
import { usePremium } from "@/hooks/usePremium";
import {
  useNewsletterFilter,
  useBulkUnsubscribeShortcuts,
} from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/hooks";
import { createSearchParams } from "@/utils/url";
import type { NewsletterFilterType } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/types";
import {
  getSuggestedModeRows,
  isUnsubscribeSuggestion,
  SUGGESTION_READ_RATE_THRESHOLD,
} from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/suggestions";
import { useStatLoader } from "@/providers/StatLoaderProvider";
import { usePremiumModal } from "@/app/(app)/premium/PremiumModal";
import { useLabels } from "@/hooks/useLabels";
import {
  BulkUnsubscribeDesktop,
  BulkUnsubscribeRowDesktop,
} from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/BulkUnsubscribeDesktop";
import { BulkUnsubscribeDesktopSkeleton } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/BulkUnsubscribeSkeleton";
import { Card } from "@/components/ui/card";
import { SenderGrid } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/SenderGrid";
import { cn } from "@/utils";
import { SearchBar } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/SearchBar";
import { useToggleSelect } from "@/hooks/useToggleSelect";
import { BulkActions } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/BulkActions";
import { ArchiveProgress } from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/ArchiveProgress";
import { ClientOnly } from "@/components/ClientOnly";
import { useAccount } from "@/providers/EmailAccountProvider";
import { LoadStatsButton } from "@/app/(app)/[emailAccountId]/stats/LoadStatsButton";
import { PageWrapper } from "@/components/PageWrapper";
import { PageHeader } from "@/components/PageHeader";
import { TextLink } from "@/components/Typography";
import { DismissibleVideoCard } from "@/components/VideoCard";
import { ActionBar } from "@/app/(app)/[emailAccountId]/stats/ActionBar";
import { DatePickerWithRange } from "@/components/DatePickerWithRange";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Newsletter = NewsletterStatsResponse["newsletters"][number];

const filterOptions: {
  label: string;
  value: NewsletterFilterType;
  icon: React.ReactNode;
  separatorAfter?: boolean;
}[] = [
  {
    label: "Unhandled",
    value: "unhandled",
    icon: <InboxIcon className="size-4" />,
  },
  {
    label: "All",
    value: "all",
    icon: <ListIcon className="size-4" />,
    separatorAfter: true,
  },
  {
    label: "Unsubscribed",
    value: "unsubscribed",
    icon: <MailXIcon className="size-4" />,
  },
  {
    label: "Auto Archive",
    value: "autoArchived",
    icon: <ArchiveIcon className="size-4" />,
  },
  {
    label: "Approved",
    value: "approved",
    icon: <ThumbsUpIcon className="size-4" />,
  },
];

type SenderChip = "all" | "newsletters" | "unopened" | "rarelyRead";
type ViewMode = "grid" | "list";

const selectOptions = [
  { label: "Last week", value: "7" },
  { label: "Last month", value: "30" },
  { label: "Last 3 months", value: "90" },
  { label: "Last year", value: "365" },
  { label: "All", value: "0" },
];
const defaultSelected = selectOptions[2];

export function BulkUnsubscribe() {
  const [dateDropdown, setDateDropdown] = useState<string>(
    defaultSelected.label,
  );

  const now = useMemo(() => new Date(), []);

  const onSetDateDropdown = useCallback(
    (option: { label: string; value: string }) => {
      const { label, value } = option;
      setDateDropdown(label);
      // When "All" is selected (value "0"), set dateRange to undefined to skip date filtering
      if (value === "0") {
        setDateRange(undefined);
      } else {
        setDateRange({
          from: subDays(now, Number.parseInt(value)),
          to: now,
        });
      }
    },
    [now],
  );

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(now, Number.parseInt(defaultSelected.value)),
    to: now,
  });

  const { isLoading: isStatsLoaderLoading, onLoad } = useStatLoader();
  const refreshInterval = isStatsLoaderLoading ? 5000 : 1_000_000;
  useEffect(() => {
    onLoad({ loadBefore: false, showToast: false });
  }, [onLoad]);

  const { emailAccountId, userEmail } = useAccount();

  const [sortColumn, setSortColumn] = useState<
    "emails" | "unread" | "unarchived"
  >("emails");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const handleSort = useCallback(
    (column: "emails" | "unread" | "unarchived") => {
      if (sortColumn === column) {
        // Toggle direction if clicking the same column
        setSortDirection((prev) => (prev === "desc" ? "asc" : "desc"));
      } else {
        // Set new column with default desc direction
        setSortColumn(column);
        setSortDirection("desc");
      }
    },
    [sortColumn],
  );

  const { typesArray } = useEmailsToIncludeFilter();
  const { filtersArray, filter, setFilter } = useNewsletterFilter();
  const posthog = usePostHog();

  const [search, setSearch] = useState("");

  const [expanded, setExpanded] = useState(false);

  const params: NewsletterStatsQuery = {
    types: typesArray,
    filters: filtersArray,
    orderBy: sortColumn,
    orderDirection: sortDirection,
    limit: expanded ? 500 : 50,
    includeMissingUnsubscribe: true,
    ...getDateRangeParams(dateRange),
    ...(search ? { search } : {}),
  };
  const urlParams = createSearchParams(params);
  const { data, isLoading, isValidating, error, mutate } = useSWR<
    NewsletterStatsResponse,
    { error: string }
  >(`/api/user/stats/newsletters?${urlParams}`, {
    refreshInterval,
    keepPreviousData: true,
  });

  // Track whether we're switching views (filter, sort, search, date range, expanded)
  // Show skeleton when validating with different params, not on background refresh
  const [lastFetchedParams, setLastFetchedParams] = useState<string>("");
  const currentParamsString = urlParams.toString();
  const isParamsChanged = lastFetchedParams !== currentParamsString;
  const showSkeleton = isValidating && isParamsChanged;

  // Update lastFetchedParams when data arrives for new params
  useEffect(() => {
    if (!isValidating && data) {
      setLastFetchedParams(currentParamsString);
    }
  }, [isValidating, data, currentParamsString]);

  const { hasUnsubscribeAccess, mutate: refetchPremium } = usePremium();

  const [openedNewsletter, setOpenedNewsletter] = useState<Newsletter>();

  const onOpenNewsletter = (newsletter: Newsletter) => {
    setOpenedNewsletter(newsletter);
    posthog?.capture("Clicked Expand Sender");
  };

  const [selectedRow, setSelectedRow] = useState<Newsletter | undefined>();

  useBulkUnsubscribeShortcuts({
    newsletters: data?.newsletters,
    selectedRow,
    onOpenNewsletter,
    setSelectedRow,
    refetchPremium,
    hasUnsubscribeAccess,
    mutate,
    userEmail,
    emailAccountId,
  });

  const { isLoading: isStatsLoading } = useStatLoader();

  const { userLabels } = useLabels();

  const { PremiumModal, openModal } = usePremiumModal();

  // Data is now filtered, sorted, and limited by the backend
  const rows = data?.newsletters;
  const [isSuggestedMode, setIsSuggestedMode] = useState(false);

  const {
    selected,
    onToggleSelect,
    onToggleSelectItems,
    selectItems,
    clearSelection,
    deselectItem,
  } = useToggleSelect(rows?.map((item) => ({ id: item.name })) || []);

  const suggestedRows = useMemo(
    () => rows?.filter(isUnsubscribeSuggestion) ?? [],
    [rows],
  );

  const [chip, setChip] = useState<SenderChip>("all");
  const [viewMode, setViewMode] = useLocalStorage<ViewMode>(
    "bulk-unsubscribe-view",
    "grid",
    { initializeWithValue: false },
  );

  const chipCounts = useMemo(() => getChipCounts(rows ?? []), [rows]);

  const visibleRows = useMemo(() => {
    const base = isSuggestedMode
      ? getSuggestedModeRows(rows ?? [], selected)
      : (rows ?? []);
    return base.filter((row) => matchesChip(row, chip));
  }, [isSuggestedMode, rows, selected, chip]);
  const visibleRowIds = useMemo(
    () => visibleRows.map((row) => row.name),
    [visibleRows],
  );
  const isAllVisibleSelected =
    visibleRows.length > 0 &&
    visibleRows.every((row) => selected.get(row.name));
  const isSomeVisibleSelected = visibleRows.some((row) =>
    selected.get(row.name),
  );

  const onToggleSuggestedMode = useCallback(() => {
    if (isSuggestedMode) {
      setIsSuggestedMode(false);
      return;
    }

    selectItems(suggestedRows.map((row) => row.name));
    setIsSuggestedMode(true);
    posthog?.capture("Clicked Select Suggested Unsubscribes", {
      count: suggestedRows.length,
    });
  }, [isSuggestedMode, selectItems, suggestedRows, posthog]);

  const onToggleVisibleRow = useCallback(
    (id: string, shiftKey = false) =>
      onToggleSelect(id, shiftKey, visibleRowIds),
    [onToggleSelect, visibleRowIds],
  );

  const onToggleSelectAllVisible = useCallback(
    () => onToggleSelectItems(visibleRowIds),
    [onToggleSelectItems, visibleRowIds],
  );

  // Clear selection when filter changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally clearing selection when filter changes
  useEffect(() => {
    clearSelection();
    setIsSuggestedMode(false);
  }, [filter]);

  // Deep link (e.g. from the inbox health email or onboarding):
  // ?select=suggested auto-selects the suggested rows once after the first
  // rows load, then strips the param so re-renders and filter changes don't
  // reselect.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const hasAppliedSelectParamRef = useRef(false);

  useEffect(() => {
    if (hasAppliedSelectParamRef.current) return;
    if (searchParams.get("select") !== "suggested") return;
    if (!rows) return;

    hasAppliedSelectParamRef.current = true;
    selectItems(rows.filter(isUnsubscribeSuggestion).map((row) => row.name));
    setIsSuggestedMode(true);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("select");
    router.replace(nextParams.size ? `${pathname}?${nextParams}` : pathname, {
      scroll: false,
    });
  }, [searchParams, rows, selectItems, router, pathname]);

  // Backend now handles sorting, so we just map the rows in order
  const tableRows = visibleRows.map((item) => {
    const readPercentage =
      item.value > 0 ? (item.readEmails / item.value) * 100 : 0;

    return (
      <BulkUnsubscribeRowDesktop
        key={item.name}
        item={item}
        userEmail={userEmail}
        emailAccountId={emailAccountId}
        onOpenNewsletter={onOpenNewsletter}
        labels={userLabels}
        mutate={mutate}
        selected={selectedRow?.name === item.name}
        onSelectRow={() => setSelectedRow(item)}
        onDoubleClick={() => onOpenNewsletter(item)}
        hasUnsubscribeAccess={hasUnsubscribeAccess}
        refetchPremium={refetchPremium}
        openPremiumModal={openModal}
        checked={selected.get(item.name) || false}
        onToggleSelect={onToggleVisibleRow}
        readPercentage={readPercentage}
        filter={filter}
      />
    );
  });

  const selectedFilter = filterOptions.find((opt) => opt.value === filter);

  return (
    <PageWrapper>
      <PageHeader
        title="Bulk Unsubscriber"
        video={{
          title: "Getting started with Bulk Unsubscribe",
          description: (
            <>
              Learn how to quickly bulk unsubscribe from and archive unwanted
              emails. You can read more in our{" "}
              <TextLink
                href="https://docs.getinboxzero.com/essentials/bulk-email-unsubscriber"
                target="_blank"
                rel="noopener noreferrer"
              >
                help center
              </TextLink>
              .
            </>
          ),
          youtubeVideoId: "T1rnooV4OYc",
        }}
      />

      <DismissibleVideoCard
        className="my-4"
        icon={<ArchiveIcon className="size-5" />}
        title="Getting started with Bulk Unsubscribe"
        description={
          "Learn how to use the Bulk Unsubscribe to unsubscribe from and archive unwanted emails."
        }
        videoSrc="https://www.youtube.com/embed/T1rnooV4OYc"
        youtubeVideoId="T1rnooV4OYc"
        thumbnailSrc="https://img.youtube.com/vi/T1rnooV4OYc/0.jpg"
        storageKey="bulk-unsubscribe-onboarding-video"
        videoAnalytics={{
          page: "bulk_unsubscribe",
          surface: "dismissible_card",
        }}
      />

      <div className="items-center justify-between flex mt-4 flex-wrap">
        <ActionBar
          rightContent={
            <>
              <div className="flex rounded-xl bg-muted p-0.5">
                {(
                  [
                    { mode: "grid", label: "Grid view", icon: LayoutGridIcon },
                    { mode: "list", label: "List view", icon: ListIcon },
                  ] as const
                ).map(({ mode, label, icon: Icon }) => (
                  <button
                    key={mode}
                    type="button"
                    aria-label={label}
                    aria-pressed={viewMode === mode}
                    title={label}
                    onClick={() => setViewMode(mode)}
                    className={cn(
                      "rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors",
                      viewMode === mode && "bg-card text-foreground shadow-sm",
                    )}
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </div>
              <LoadStatsButton />
            </>
          }
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-10">
                {selectedFilter?.icon}
                <span className="ml-2">{selectedFilter?.label ?? "All"}</span>
                <ChevronDown className="ml-2 h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[170px]">
              {filterOptions.map((option) => (
                <div key={option.value}>
                  <DropdownMenuItem
                    onClick={() => setFilter(option.value)}
                    className="flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      {option.icon}
                      {option.label}
                    </span>
                    {filter === option.value && (
                      <CheckIcon className="h-4 w-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                  {option.separatorAfter && <DropdownMenuSeparator />}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DatePickerWithRange
            dateRange={dateRange}
            onSetDateRange={setDateRange}
            selectOptions={selectOptions}
            dateDropdown={dateDropdown}
            onSetDateDropdown={onSetDateDropdown}
          />
          <SearchBar onSearch={setSearch} />
          {(suggestedRows.length > 0 || isSuggestedMode) && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isSuggestedMode ? "secondary" : "outline"}
                    size="sm"
                    className="h-10"
                    aria-pressed={isSuggestedMode}
                    onClick={onToggleSuggestedMode}
                  >
                    <SparklesIcon className="size-4 text-queue-reply" />
                    <span className="ml-2">
                      {isSuggestedMode ? "Showing" : "Select"}{" "}
                      {suggestedRows.length} suggested
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    {isSuggestedMode
                      ? "Shows suggested senders and any other senders you already selected. Click to show all senders."
                      : `Selects and shows senders you rarely read (under ${SUGGESTION_READ_RATE_THRESHOLD}% read rate) so you can unsubscribe, block, or archive them in one go.`}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </ActionBar>
      </div>

      {!!rows?.length && (
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { value: rows.length, label: "Senders" },
            { value: chipCounts.unopened, label: "Never opened" },
            {
              value: chipCounts.newsletters,
              label: "Have an unsubscribe link",
            },
            { value: suggestedRows.length, label: "Ready to remove" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3.5"
            >
              <div className="font-display text-3xl leading-none">
                {stat.value.toLocaleString()}
              </div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {!!rows?.length && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(
            [
              { value: "all", label: "All", count: rows.length },
              {
                value: "newsletters",
                label: "Newsletters",
                count: chipCounts.newsletters,
              },
              {
                value: "unopened",
                label: "Unopened",
                count: chipCounts.unopened,
              },
              {
                value: "rarelyRead",
                label: "Rarely read",
                count: chipCounts.rarelyRead,
              },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={chip === option.value}
              onClick={() => setChip(option.value)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                chip === option.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label} {option.count}
            </button>
          ))}
        </div>
      )}

      <ClientOnly>
        <ArchiveProgress />
      </ClientOnly>

      <BulkActions
        selected={selected}
        mutate={mutate}
        onClearSelection={clearSelection}
        deselectItem={deselectItem}
        newsletters={rows}
        filter={filter}
        totalCount={rows?.length ?? 0}
        dateRange={dateRange}
      />

      <Card className="mt-2 rounded-2xl md:mt-4 max-sm:border-0 max-sm:shadow-none">
        {(isStatsLoading && !isLoading && !data?.newsletters.length) ||
        showSkeleton ? (
          <BulkUnsubscribeDesktopSkeleton />
        ) : (
          <LoadingContent
            loading={!data && isLoading}
            error={error}
            loadingComponent={<BulkUnsubscribeDesktopSkeleton />}
          >
            {tableRows?.length ? (
              <>
                {viewMode === "grid" ? (
                  <SenderGrid
                    rows={visibleRows}
                    selected={selected}
                    selectedRowName={selectedRow?.name}
                    onToggleSelect={onToggleVisibleRow}
                    onSelectRow={setSelectedRow}
                    onOpenNewsletter={onOpenNewsletter}
                    userEmail={userEmail}
                    emailAccountId={emailAccountId}
                    labels={userLabels}
                    mutate={mutate}
                    hasUnsubscribeAccess={hasUnsubscribeAccess}
                    refetchPremium={refetchPremium}
                    openPremiumModal={openModal}
                    filter={filter}
                  />
                ) : (
                  <BulkUnsubscribeDesktop
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    tableRows={tableRows}
                    isAllSelected={isAllVisibleSelected}
                    isSomeSelected={isSomeVisibleSelected}
                    onToggleSelectAll={onToggleSelectAllVisible}
                  />
                )}
                {/* Only show expand/collapse when there might be more results */}
                {(expanded || (rows && rows.length >= 50)) && (
                  <div className="mt-2 px-6 pb-6">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExpanded(!expanded)}
                      className="w-full"
                    >
                      {expanded ? (
                        <>
                          <ChevronsUpIcon className="h-4 w-4" />
                          <span className="ml-2">Show less</span>
                        </>
                      ) : (
                        <>
                          <ChevronsDownIcon className="h-4 w-4" />
                          <span className="ml-2">Show more</span>
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-4">
                <InboxIcon className="h-16 w-16 text-muted-foreground/40" />
                <h3 className="mt-4 text-lg font-semibold">No emails found</h3>
                <p className="mt-2 text-center text-muted-foreground">
                  Adjust the filters or click "Load More" to load additional
                  emails.
                </p>
              </div>
            )}
          </LoadingContent>
        )}
      </Card>
      <NewsletterModal
        newsletter={openedNewsletter}
        onClose={() => setOpenedNewsletter(undefined)}
        refreshInterval={refreshInterval}
        mutate={mutate}
      />
      <PremiumModal />
    </PageWrapper>
  );
}

function matchesChip(row: Newsletter, chip: SenderChip) {
  if (chip === "newsletters") return Boolean(row.unsubscribeLink);
  if (chip === "unopened") return row.readEmails === 0;
  if (chip === "rarelyRead") return isUnsubscribeSuggestion(row);
  return true;
}

function getChipCounts(rows: Newsletter[]) {
  return {
    newsletters: rows.filter((row) => matchesChip(row, "newsletters")).length,
    unopened: rows.filter((row) => matchesChip(row, "unopened")).length,
    rarelyRead: rows.filter((row) => matchesChip(row, "rarelyRead")).length,
  };
}
