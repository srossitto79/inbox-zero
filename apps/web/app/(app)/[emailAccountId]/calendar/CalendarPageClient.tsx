"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useHotkeys } from "react-hotkeys-hook";
import {
  CalendarDaysIcon,
  CalendarSearchIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  RotateCcwIcon,
} from "lucide-react";
import { ConnectCalendar } from "@/app/(app)/[emailAccountId]/calendars/ConnectCalendar";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FindATimeDialog,
  type FindATimeSlot,
} from "@/components/calendar/FindATimeDialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { GetCalendarEventsResponse } from "@/app/api/user/calendar/events/route";
import { useCalendarEvents } from "@/hooks/useCalendarEvents";
import { useCalendarPreferences } from "@/hooks/useCalendarPreferences";
import { useCalendars } from "@/hooks/useCalendars";
import { useAccount } from "@/providers/EmailAccountProvider";
import { syncCalendarsAction } from "@/utils/actions/calendar";
import { toastError } from "@/components/Toast";
import {
  type CalendarViewType,
  getRangeInstants,
  getVisibleDateKeys,
  shiftAnchor,
} from "@/utils/calendar/event-range";
import { minutesToInstant } from "@/utils/calendar/drag-math";
import type { CalendarPreferences } from "@/utils/calendar/preferences/preferences";
import { parseTimeOfDay } from "@/utils/calendar/preferences/working-hours";
import {
  getWriteBlock,
  getWriteBlockMessage,
} from "@/utils/calendar/write/policy";
import {
  createEditorState,
  editorStateToCreatePayload,
  editorStateToUpdatePayload,
  eventToEditorState,
  type EditorState,
} from "@/utils/calendar/event-editor-state";
import { toDateKey } from "@/utils/calendar/zoned-time";
import {
  CalendarEditingContext,
  type CreateRange,
} from "./CalendarEditingContext";
import { CalendarEventEditor, type EditorSession } from "./CalendarEventEditor";
import { CalendarImportExport } from "./CalendarImportExport";
import { CalendarViews } from "./CalendarViews";
import { useCalendarEventMutations } from "./useCalendarEventMutations";

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
  const { preferences } = useCalendarPreferences();
  const { executeAsync: startSync, isExecuting } = useAction(
    syncCalendarsAction.bind(null, emailAccountId),
  );

  const timezone =
    calendarData?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  const todayKey = toDateKey(new Date(), timezone);
  const anchorKey = getValidDateKey(searchParams.get("date"), todayKey);
  // The URL view wins; an absent one opens on the user's default. Preferences
  // resolve to the built-in default until they load, so this never flashes.
  const view = getViewFromParam(
    searchParams.get("view"),
    preferences.defaultView,
  );
  const dateKeys = useMemo(
    () =>
      getVisibleDateKeys({ view, anchorKey, weekStart: preferences.weekStart }),
    [view, anchorKey, preferences.weekStart],
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

  const connections = calendarData?.connections ?? [];
  const enabledCalendars = connections.flatMap((connection) =>
    connection.calendars
      .filter((calendar) => calendar.isEnabled)
      .map((calendar) => ({ id: calendar.id, name: calendar.name })),
  );
  const writableCalendars = connections.flatMap((connection) =>
    connection.calendars.flatMap((calendar) =>
      calendar.canEdit &&
      getWriteBlock({
        provider: connection.provider,
        state: connection.state,
        canEdit: true,
      }) === null
        ? [{ id: calendar.id, name: calendar.name, color: calendar.color }]
        : [],
    ),
  );
  const calendarRefsById = new Map(
    connections.flatMap((connection) =>
      connection.calendars.map((calendar) => [
        calendar.id,
        { connection, calendar },
      ]),
    ),
  );

  const mutations = useCalendarEventMutations({
    emailAccountId,
    timezone,
    mutateEvents,
  });
  const [session, setSession] = useState<EditorSession | null>(null);
  const [findTimeOpen, setFindTimeOpen] = useState(false);
  const sessionKeyRef = useRef(0);
  const focusedEventIdRef = useRef<string | null>(null);
  const setOpenEventId = useCallback((id: string | null) => {
    focusedEventIdRef.current = id;
    if (!id) focusedEventIdRef.current = null;
  }, []);

  const createBlock = useMemo(() => {
    // First enabled connection decides whether anything can be created; the
    // editor's own picker narrows to writable calendars.
    const enabled = connections.find((connection) =>
      connection.calendars.some((calendar) => calendar.isEnabled),
    );
    if (!enabled) return "no_calendar" as const;
    return getWriteBlock({
      provider: enabled.provider,
      state: enabled.state,
      canEdit: true,
    });
  }, [connections]);

  const defaultCalendarId = writableCalendars[0]?.id ?? null;

  const startCreate = useCallback(
    (range: CreateRange) => {
      if (createBlock) {
        toastError({
          description:
            createBlock === "no_calendar"
              ? "Select a calendar from the sidebar."
              : getWriteBlockMessage(createBlock),
        });
        return;
      }
      setSession({
        kind: "create",
        key: ++sessionKeyRef.current,
        initial: createEditorState({
          calendarId: defaultCalendarId ?? "",
          timeZone: timezone,
          range,
        }),
      });
    },
    [createBlock, defaultCalendarId, timezone],
  );

  const getEventBlock = useCallback(
    (event: GetCalendarEventsResponse["events"][number]) => {
      const ref = calendarRefsById.get(event.calendarId);
      return ref
        ? getWriteBlock({
            provider: ref.connection.provider,
            state: ref.connection.state,
            canEdit: ref.calendar.canEdit,
          })
        : ("disconnected" as const);
    },
    [calendarRefsById],
  );

  const edit = useCallback(
    (event: GetCalendarEventsResponse["events"][number]) => {
      const block = getEventBlock(event);
      setSession({
        kind: "edit",
        key: ++sessionKeyRef.current,
        event,
        initial: eventToEditorState(event, timezone),
        readOnlyReason: getReadOnlyReason(event, block),
      });
    },
    [getEventBlock, timezone],
  );

  const editFocused = useCallback(() => {
    if (session || !focusedEventIdRef.current || !eventsData) return;
    const event = eventsData.events.find(
      (item) => item.id === focusedEventIdRef.current,
    );
    if (event) edit(event);
  }, [edit, eventsData, session]);

  const deleteFocused = useCallback(() => {
    if (session || !focusedEventIdRef.current || !eventsData) return;
    const event = eventsData.events.find(
      (item) => item.id === focusedEventIdRef.current,
    );
    if (event) mutations.remove(event);
  }, [eventsData, mutations, session]);

  useHotkeys(
    "c",
    () => startCreate({ startDate: todayKey, endDate: todayKey }),
    {
      preventDefault: true,
    },
  );
  useHotkeys("e", editFocused, {
    preventDefault: true,
    enabled: !session,
  });
  useHotkeys("delete,backspace", deleteFocused, {
    preventDefault: true,
    enabled: !session,
  });

  const saveSession = useCallback(
    async (currentSession: EditorSession, state: EditorState) => {
      if (currentSession.kind === "create") {
        return (
          (await mutations.create(editorStateToCreatePayload(state))) ===
          "saved"
        );
      }
      const payload = editorStateToUpdatePayload({
        initial: currentSession.initial,
        current: state,
        providerEventId: currentSession.event.providerEventId,
      });
      if (!payload) return true;
      return (await mutations.update(payload)) === "saved";
    },
    [mutations],
  );

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

  if (isLoading) return <CalendarLoading />;
  if (calendarsError) {
    return <CalendarFailure onRetry={() => window.location.reload()} />;
  }
  // The derived state above already reads calendarData as possibly missing.
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
          size="sm"
          Icon={PlusIcon}
          disabled={!defaultCalendarId || Boolean(createBlock)}
          title={
            createBlock === "no_calendar"
              ? undefined
              : createBlock
                ? getWriteBlockMessage(createBlock)
                : undefined
          }
          onClick={() => {
            if (createBlock) return;
            startCreate(
              view === "day"
                ? dayAnchorRange(anchorKey, timezone, preferences)
                : { startDate: todayKey, endDate: todayKey },
            );
          }}
        >
          New event
        </Button>
        <Button
          variant="outline"
          size="sm"
          Icon={CalendarSearchIcon}
          disabled={!defaultCalendarId || Boolean(createBlock)}
          onClick={() => setFindTimeOpen(true)}
        >
          Find a time
        </Button>
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
        <CalendarImportExport
          range={range}
          timezone={timezone}
          calendars={enabledCalendars}
          importCalendar={writableCalendars[0] ?? null}
          onImported={() => mutateEvents()}
        />
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
        <CalendarEditingContext.Provider
          value={{
            createBlock:
              createBlock === "no_calendar" ? "unsupported" : createBlock,
            getEventBlock,
            setFocusedEventId: setOpenEventId,
            setOpenEventId,
            create: startCreate,
            edit,
            remove: (event) => mutations.remove(event),
            respond: mutations.respond,
            moveTimed: mutations.moveTimed,
            resizeTimed: mutations.resizeTimed,
            moveAllDay: mutations.moveAllDay,
          }}
        >
          <CalendarViews
            view={view}
            dateKeys={dateKeys}
            events={eventsData?.events ?? []}
            timezone={timezone}
            todayKey={todayKey}
            preferences={preferences}
          />
        </CalendarEditingContext.Provider>
      )}
      <CalendarEventEditor
        session={session}
        calendars={writableCalendars}
        onClose={() => setSession(null)}
        onSave={saveSession}
        onDelete={(event) => mutations.remove(event)}
      />
      <FindATimeDialog
        open={findTimeOpen}
        onOpenChange={setFindTimeOpen}
        attendees={[]}
        durationMinutes={preferences.defaultDurationMinutes}
        timeZone={timezone}
        onPick={(slot: FindATimeSlot) => {
          setFindTimeOpen(false);
          startCreate(slot);
        }}
      />
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

function getViewFromParam(
  value: string | null,
  defaultView: CalendarViewType,
): CalendarViewType {
  return value === "day" ||
    value === "month" ||
    value === "agenda" ||
    value === "week"
    ? value
    : defaultView;
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

function dayAnchorRange(
  anchorKey: string,
  timeZone: string,
  preferences: CalendarPreferences,
): { start: Date; end: Date } {
  // Opens the day's first working hour, for the default event length.
  const startMinutes = parseTimeOfDay(preferences.workingHours.start);
  const start = minutesToInstant(anchorKey, startMinutes, timeZone);
  return {
    start,
    end: new Date(
      start.getTime() + preferences.defaultDurationMinutes * 60_000,
    ),
  };
}

function getReadOnlyReason(
  event: GetCalendarEventsResponse["events"][number],
  block: ReturnType<typeof getWriteBlock> | null,
): string | null {
  if (event.isRecurring) return "Recurring events are read-only";
  if (!block) return null;
  const message = getWriteBlockMessage(block);
  return message;
}
