"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useHotkeys } from "react-hotkeys-hook";
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  RotateCcwIcon,
} from "lucide-react";
import { ConnectCalendar } from "@/app/(app)/[emailAccountId]/calendars/ConnectCalendar";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useCalendarEvents } from "@/hooks/useCalendarEvents";
import { useCalendars } from "@/hooks/useCalendars";
import { useAccount } from "@/providers/EmailAccountProvider";
import { syncCalendarsAction } from "@/utils/actions/calendar";
import {
  type CalendarViewType,
  getRangeInstants,
  getVisibleDateKeys,
  shiftAnchor,
} from "@/utils/calendar/event-range";
import { toDateKey } from "@/utils/calendar/zoned-time";
import { CalendarViews } from "./CalendarViews";

const VIEW_OPTIONS = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
  { label: "Agenda", value: "agenda" },
] satisfies Array<{ label: string; value: CalendarViewType }>;

export function CalendarPageClient() {
  const { emailAccountId } = useAccount();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const router = useRouter();
  const {
    data: calendarData,
    error: calendarsError,
    isLoading,
    mutate: mutateCalendars,
  } = useCalendars({
    refreshInterval: 5000,
  });
  const { executeAsync: startSync, isExecuting } = useAction(
    syncCalendarsAction.bind(null, emailAccountId),
  );

  const timezone =
    calendarData?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  const todayKey = toDateKey(new Date(), timezone);
  const anchorKey = getValidDateKey(searchParams.get("date"), todayKey);
  const view = getValidView(searchParams.get("view"));
  const dateKeys = useMemo(
    () => getVisibleDateKeys({ view, anchorKey, weekStartsOn: 1 }),
    [view, anchorKey],
  );
  const range = useMemo(
    () => getRangeInstants(dateKeys, timezone),
    [dateKeys, timezone],
  );
  const hasEnabledCalendar =
    calendarData?.connections.some((connection) =>
      connection.calendars.some((calendar) => calendar.isEnabled),
    ) ?? false;
  const {
    data: eventsData,
    error: eventsError,
    isLoading: eventsLoading,
    mutate: mutateEvents,
  } = useCalendarEvents({
    ...range,
    timezone,
    enabled: hasEnabledCalendar,
  });

  const updateQuery = useCallback(
    (updates: { view?: CalendarViewType; date?: string }) => {
      const next = new URLSearchParams(searchParams);
      if (updates.view) next.set("view", updates.view);
      if (updates.date) next.set("date", updates.date);
      router.push(`${pathname}?${next}`);
    },
    [pathname, router, searchParams],
  );
  const move = useCallback(
    (direction: 1 | -1) =>
      updateQuery({ date: shiftAnchor({ view, anchorKey, direction }) }),
    [anchorKey, updateQuery, view],
  );

  useHotkeys("t", () => updateQuery({ date: todayKey }), {
    preventDefault: true,
  });
  useHotkeys("left", () => move(-1), { preventDefault: true });
  useHotkeys("right", () => move(1), { preventDefault: true });
  useHotkeys("d", () => updateQuery({ view: "day" }), {
    preventDefault: true,
  });
  useHotkeys("w", () => updateQuery({ view: "week" }), {
    preventDefault: true,
  });
  useHotkeys("m", () => updateQuery({ view: "month" }), {
    preventDefault: true,
  });
  useHotkeys("a", () => updateQuery({ view: "agenda" }), {
    preventDefault: true,
  });

  if (isLoading) return <CalendarLoading />;
  if (calendarsError || !calendarData) {
    return <CalendarFailure onRetry={() => window.location.reload()} />;
  }

  const connections = calendarData.connections;
  if (connections.length === 0) {
    return (
      <CalendarEmptyState
        title="Connect a calendar"
        description="Google Calendar or Outlook"
      >
        <ConnectCalendar onboardingReturnPath={`/${emailAccountId}/calendar`} />
      </CalendarEmptyState>
    );
  }

  const missingConnections = connections.filter(
    (connection) => connection.state !== "connected",
  );
  const calendars = connections.flatMap((connection) => connection.calendars);
  const statuses = calendars.map((calendar) => calendar.syncStatus);
  const syncing = statuses.includes("SYNCING") || isExecuting;
  const paused = statuses.includes("PAUSED");
  const syncError = statuses.includes("ERROR");

  const syncNow = async () => {
    await startSync({});
    await Promise.all([mutateCalendars(), mutateEvents()]);
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3 lg:px-6">
        <div className="mr-auto min-w-52">
          <h1 className="font-display text-xl font-semibold">
            {formatRangeTitle(view, dateKeys)}
          </h1>
          <p className="text-xs text-muted-foreground">{timezone}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="iconSm"
            aria-label="Previous"
            onClick={() => move(-1)}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => updateQuery({ date: todayKey })}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="iconSm"
            aria-label="Next"
            onClick={() => move(1)}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
        <SegmentedControl
          aria-label="Calendar view"
          options={VIEW_OPTIONS}
          value={view}
          onChange={(nextView) => updateQuery({ view: nextView })}
        />
        <Button
          variant="ghostMuted"
          size="iconSm"
          aria-label="Sync now"
          title="Sync now"
          loading={syncing}
          onClick={syncNow}
        >
          <RefreshCwIcon className="size-4" />
        </Button>
      </header>

      {missingConnections.map((connection) => (
        <div
          key={connection.id}
          className="flex flex-wrap items-center gap-3 border-b border-border bg-muted px-4 py-2 text-sm lg:px-6"
        >
          <span className="mr-auto">
            {connection.state === "missing_scopes"
              ? `${providerName(connection.provider)} permissions changed.`
              : `${providerName(connection.provider)} disconnected.`}
          </span>
          <ConnectCalendar
            provider={connection.provider as "google" | "microsoft"}
            reconnect
            onboardingReturnPath={`/${emailAccountId}/calendar`}
          />
        </div>
      ))}

      {paused ? (
        <StatusBar>Sync paused. It will retry automatically.</StatusBar>
      ) : null}
      {syncError ? <StatusBar>Calendar sync failed.</StatusBar> : null}

      {!hasEnabledCalendar ? (
        <CalendarEmptyState
          title="No calendars selected"
          description="Select a calendar from the sidebar."
        />
      ) : eventsError ? (
        <CalendarFailure onRetry={() => mutateEvents()} />
      ) : eventsLoading && !eventsData ? (
        <CalendarLoading />
      ) : (
        <CalendarViews
          view={view}
          dateKeys={dateKeys}
          events={eventsData?.events ?? []}
          timezone={timezone}
          todayKey={todayKey}
        />
      )}
    </main>
  );
}

function StatusBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground lg:px-6">
      {children}
    </div>
  );
}

function CalendarLoading() {
  return (
    <div className="flex min-h-0 flex-1 animate-pulse flex-col gap-3 p-6">
      <div className="h-9 w-64 rounded-lg bg-muted" />
      <div className="min-h-80 flex-1 rounded-xl bg-muted" />
    </div>
  );
}

function CalendarFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <CalendarEmptyState title="Calendar unavailable" description="Try again.">
      <Button variant="outline" Icon={RotateCcwIcon} onClick={onRetry}>
        Retry
      </Button>
    </CalendarEmptyState>
  );
}

function CalendarEmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <Empty className="m-4 border border-border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarDaysIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  );
}

function getValidView(value: string | null): CalendarViewType {
  return value === "day" ||
    value === "month" ||
    value === "agenda" ||
    value === "week"
    ? value
    : "week";
}

function getValidDateKey(value: string | null, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function formatRangeTitle(view: CalendarViewType, dateKeys: string[]) {
  const dates = dateKeys.map((dateKey) => new Date(`${dateKey}T12:00:00.000Z`));
  if (view === "day") {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(dates[0]);
  }
  if (view === "month") {
    const anchor = dates[Math.floor(dates.length / 2)];
    return new Intl.DateTimeFormat(undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(anchor);
  }
  const format = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const first = format.format(dates[0]);
  const last = format.format(dates[dates.length - 1]);
  return `${first} – ${last}`;
}

function providerName(provider: string) {
  return provider === "microsoft" ? "Outlook Calendar" : "Google Calendar";
}
