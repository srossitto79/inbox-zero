"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GetCalendarEventsResponse } from "@/app/api/user/calendar/events/route";
import { cn } from "@/utils";
import {
  computeClickSlot,
  computeCreateRange,
  computeCreateRangeMinutes,
  findColumnIndex,
  MINUTES_PER_DAY,
  moveEventByDays,
  moveTimedEvent,
  pixelsToMinutes,
  resizeTimedEvent,
} from "@/utils/calendar/drag-math";
import {
  type CalendarViewType,
  getDaySegment,
  groupEventsByDay,
} from "@/utils/calendar/event-range";
import { layoutDayEvents } from "@/utils/calendar/event-layout";
import { diffDateKeys, toWallClock } from "@/utils/calendar/zoned-time";
import {
  type CalendarEditing,
  useCalendarEditing,
} from "./CalendarEditingContext";
import { EventChip } from "./CalendarEventPopover";

type CalendarEvent = GetCalendarEventsResponse["events"][number];

const HOUR_HEIGHT = 64;
const DAY_HEIGHT = 24 * HOUR_HEIGHT;
const DAY_MIN_WIDTH = 128;
const TIME_GUTTER = 64;

type Gesture =
  | {
      kind: "create";
      dateKey: string;
      startY: number;
      anchor: number;
      active: boolean;
    }
  | {
      kind: "move";
      event: CalendarEvent;
      startX: number;
      startY: number;
      originIndex: number;
      active: boolean;
    }
  | {
      kind: "resize";
      event: CalendarEvent;
      startY: number;
      active: boolean;
    }
  | {
      kind: "moveAllDay";
      event: CalendarEvent;
      startX: number;
      originIndex: number;
      active: boolean;
    };

type EventChange =
  | { kind: "timed"; start: Date; end: Date }
  | { kind: "allDay"; startDate: string; endDate: string };

type GestureResult =
  | { kind: "pending" }
  | { kind: "create"; start: number; end: number; pointerMinutes: number }
  | { kind: "event"; change: EventChange };

type Preview =
  | { kind: "create"; dateKey: string; start: number; end: number }
  | { kind: "event"; eventId: string; change: EventChange };

const DRAG_THRESHOLD_PX = 4;

export function CalendarViews({
  view,
  dateKeys,
  events,
  timezone,
  todayKey,
}: {
  view: CalendarViewType;
  dateKeys: string[];
  events: CalendarEvent[];
  timezone: string;
  todayKey: string;
}) {
  if (view === "month") {
    return (
      <MonthView
        dateKeys={dateKeys}
        events={events}
        timezone={timezone}
        todayKey={todayKey}
      />
    );
  }
  if (view === "agenda") {
    return (
      <AgendaView
        dateKeys={dateKeys}
        events={events}
        timezone={timezone}
        todayKey={todayKey}
      />
    );
  }
  return (
    <TimeGrid
      dateKeys={dateKeys}
      events={events}
      timezone={timezone}
      todayKey={todayKey}
    />
  );
}

function TimeGrid({
  dateKeys,
  events,
  timezone,
  todayKey,
}: {
  dateKeys: string[];
  events: CalendarEvent[];
  timezone: string;
  todayKey: string;
}) {
  const editing = useCalendarEditing();
  const gridRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const lastGestureEndRef = useRef(0);
  const [preview, setPreview] = useState<Preview | null>(null);

  const displayEvents = useMemo(
    () =>
      preview?.kind === "event"
        ? events.map((event) =>
            event.id === preview.eventId
              ? applyChange(event, preview.change)
              : event,
          )
        : events,
    [events, preview],
  );
  const byDay = useMemo(
    () => groupEventsByDay(displayEvents, dateKeys, timezone),
    [displayEvents, dateKeys, timezone],
  );
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const getColumns = () => getColumnRects(gridRef.current);

    const onMove = (pointer: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const result = evaluateGesture({
        gesture,
        x: pointer.clientX,
        y: pointer.clientY,
        columns: getColumns(),
        dateKeys,
        timezone,
      });
      if (result.kind === "pending") return;
      gesture.active = true;
      if (result.kind === "create" && gesture.kind === "create") {
        setPreview({
          kind: "create",
          dateKey: gesture.dateKey,
          start: result.start,
          end: result.end,
        });
      } else if (result.kind === "event" && gesture.kind !== "create") {
        setPreview({
          kind: "event",
          eventId: gesture.event.id,
          change: result.change,
        });
      }
    };

    const finish = (pointer: PointerEvent, cancelled: boolean) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      gestureRef.current = null;
      setPreview(null);
      if (cancelled || !editing) return;

      const result = evaluateGesture({
        gesture,
        x: pointer.clientX,
        y: pointer.clientY,
        columns: getColumns(),
        dateKeys,
        timezone,
      });
      if (gesture.kind === "create") {
        lastGestureEndRef.current = performance.now();
        if (result.kind === "create") {
          editing.create(
            computeCreateRange({
              dateKey: gesture.dateKey,
              anchorMinutes: gesture.anchor,
              currentMinutes: result.pointerMinutes,
              timeZone: timezone,
            }),
          );
        } else {
          editing.create(
            computeClickSlot({
              dateKey: gesture.dateKey,
              minutes: gesture.anchor,
              timeZone: timezone,
            }),
          );
        }
        return;
      }
      if (result.kind !== "event") return;
      lastGestureEndRef.current = performance.now();
      commitChange(editing, gesture, result.change);
    };

    const onUp = (pointerEvent: PointerEvent) => finish(pointerEvent, false);
    const onCancel = (pointerEvent: PointerEvent) => finish(pointerEvent, true);
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape" || !gestureRef.current) return;
      gestureRef.current = null;
      setPreview(null);
    };
    // A drag that ends over its own chip would otherwise open the popover.
    const swallowClick = (clickEvent: MouseEvent) => {
      if (performance.now() - lastGestureEndRef.current > 250) return;
      clickEvent.stopPropagation();
      clickEvent.preventDefault();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", swallowClick, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", swallowClick, true);
    };
  }, [dateKeys, editing, timezone]);

  const nowWall = toWallClock(now, timezone);
  const nowMinutes = nowWall.hour * 60 + nowWall.minute;
  const minWidth = TIME_GUTTER + dateKeys.length * DAY_MIN_WIDTH;
  const columns = `${TIME_GUTTER}px repeat(${dateKeys.length}, minmax(${DAY_MIN_WIDTH}px, 1fr))`;

  const startEventGesture = (
    event: CalendarEvent,
    kind: "move" | "resize" | "moveAllDay",
    pointer: React.PointerEvent,
  ) => {
    if (!isPrimaryPointer(pointer) || !isDraggable(editing, event)) return;
    const originIndex = findColumnIndex(
      pointer.clientX,
      getColumnRects(gridRef.current),
    );
    if (kind === "move") {
      gestureRef.current = {
        kind,
        event,
        startX: pointer.clientX,
        startY: pointer.clientY,
        originIndex,
        active: false,
      };
    } else if (kind === "resize") {
      pointer.stopPropagation();
      gestureRef.current = {
        kind,
        event,
        startY: pointer.clientY,
        active: false,
      };
    } else {
      gestureRef.current = {
        kind,
        event,
        startX: pointer.clientX,
        originIndex,
        active: false,
      };
    }
  };

  const startCreateGesture = (dateKey: string, pointer: React.PointerEvent) => {
    if (!editing || !isPrimaryPointer(pointer)) return;
    if (pointer.target !== pointer.currentTarget) return;
    pointer.preventDefault();
    const rect = pointer.currentTarget.getBoundingClientRect();
    gestureRef.current = {
      kind: "create",
      dateKey,
      startY: pointer.clientY,
      anchor: pixelsToMinutes({
        pointerY: pointer.clientY,
        columnTop: rect.top,
        hourHeight: HOUR_HEIGHT,
      }),
      active: false,
    };
  };

  return (
    <div className="min-h-0 flex-1 select-none overflow-auto bg-card">
      <div ref={gridRef} style={{ minWidth }}>
        <div
          className="sticky top-0 z-20 grid border-b border-border bg-card"
          style={{ gridTemplateColumns: columns }}
        >
          <div />
          {dateKeys.map((dateKey) => (
            <DayHeading
              key={dateKey}
              dateKey={dateKey}
              today={dateKey === todayKey}
            />
          ))}
        </div>

        <div
          className="sticky top-[53px] z-20 grid min-h-10 border-b border-border bg-card"
          style={{ gridTemplateColumns: columns }}
        >
          <div className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            All-day
          </div>
          {dateKeys.map((dateKey) => (
            <AllDayCell
              key={dateKey}
              dateKey={dateKey}
              events={(byDay.get(dateKey) ?? []).filter(
                (event) => event.isAllDay,
              )}
              timezone={timezone}
              draggingEventId={
                preview?.kind === "event" ? preview.eventId : null
              }
              onCreate={editing?.create}
              onEventPointerDown={startEventGesture}
            />
          ))}
        </div>

        <div className="grid" style={{ gridTemplateColumns: columns }}>
          <TimeLabels />
          {dateKeys.map((dateKey) => (
            <DayColumn
              key={dateKey}
              dateKey={dateKey}
              events={(byDay.get(dateKey) ?? []).filter(
                (event) => !event.isAllDay,
              )}
              timezone={timezone}
              showCurrentTime={dateKey === todayKey}
              nowMinutes={nowMinutes}
              createPreview={
                preview?.kind === "create" && preview.dateKey === dateKey
                  ? { start: preview.start, end: preview.end }
                  : null
              }
              draggingEventId={
                preview?.kind === "event" ? preview.eventId : null
              }
              onCreatePointerDown={startCreateGesture}
              onEventPointerDown={startEventGesture}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AllDayCell({
  dateKey,
  events,
  timezone,
  draggingEventId,
  onCreate,
  onEventPointerDown,
}: {
  dateKey: string;
  events: CalendarEvent[];
  timezone: string;
  draggingEventId: string | null;
  onCreate: CalendarEditing["create"] | undefined;
  onEventPointerDown: React.ComponentProps<
    typeof DayColumn
  >["onEventPointerDown"];
}) {
  const editing = useCalendarEditing();

  return (
    <div className="min-w-0 space-y-1 border-l border-border p-1">
      {events.map((event) => (
        <EventChip
          key={event.id}
          event={event}
          timezone={timezone}
          compact
          className="block w-full"
          dragging={draggingEventId === event.id}
          dragHandlers={{
            draggable: isDraggable(editing, event),
            onPointerDown: (pointer) =>
              onEventPointerDown(event, "moveAllDay", pointer),
          }}
        />
      ))}
      {onCreate && events.length === 0 ? (
        <button
          type="button"
          aria-label={`Create event on ${dateKey}`}
          className="h-6 w-full rounded hover:bg-accent/60"
          onClick={() => onCreate({ startDate: dateKey, endDate: dateKey })}
          onKeyUp={(keyEvent) => {
            if (keyEvent.key === "Enter") {
              onCreate({ startDate: dateKey, endDate: dateKey });
            }
          }}
        />
      ) : null}
    </div>
  );
}

function DayHeading({ dateKey, today }: { dateKey: string; today: boolean }) {
  const date = dateFromKey(dateKey);
  return (
    <div className="border-l border-border px-2 py-2 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {new Intl.DateTimeFormat(undefined, {
          weekday: "short",
          timeZone: "UTC",
        }).format(date)}
      </div>
      <div
        className={cn(
          "mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-sm font-semibold",
          today && "bg-primary text-primary-foreground",
        )}
      >
        {date.getUTCDate()}
      </div>
    </div>
  );
}

function TimeLabels() {
  return (
    <div className="relative" style={{ height: DAY_HEIGHT }}>
      {Array.from({ length: 24 }, (_, hour) => (
        <div
          key={hour}
          className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground"
          style={{ top: hour * HOUR_HEIGHT }}
        >
          {formatHour(hour)}
        </div>
      ))}
    </div>
  );
}

function DayColumn({
  dateKey,
  events,
  timezone,
  showCurrentTime,
  nowMinutes,
  createPreview,
  draggingEventId,
  onCreatePointerDown,
  onEventPointerDown,
}: {
  dateKey: string;
  events: CalendarEvent[];
  timezone: string;
  showCurrentTime: boolean;
  nowMinutes: number;
  createPreview: { start: number; end: number } | null;
  draggingEventId: string | null;
  onCreatePointerDown: (dateKey: string, pointer: React.PointerEvent) => void;
  onEventPointerDown: (
    event: CalendarEvent,
    kind: "move" | "resize" | "moveAllDay",
    pointer: React.PointerEvent,
  ) => void;
}) {
  const editing = useCalendarEditing();
  const segments = events.map((event) => ({
    id: event.id,
    ...getDaySegment(event, dateKey, timezone),
  }));
  const placements = new Map(
    layoutDayEvents(segments).map((placement) => [placement.id, placement]),
  );

  return (
    <div
      data-day-column={dateKey}
      className="relative border-l border-border"
      style={{ height: DAY_HEIGHT }}
      onPointerDown={(pointer) => onCreatePointerDown(dateKey, pointer)}
    >
      {Array.from({ length: 24 }, (_, hour) => (
        <div
          key={hour}
          className="pointer-events-none absolute inset-x-0 border-t border-border/70"
          style={{ top: hour * HOUR_HEIGHT }}
        />
      ))}
      {events.map((event) => {
        const segment = getDaySegment(event, dateKey, timezone);
        const placement = placements.get(event.id);
        if (!placement) return null;
        const width = (placement.span / placement.columns) * 100;
        const left = (placement.column / placement.columns) * 100;
        const top = (segment.start / 60) * HOUR_HEIGHT;
        const height = Math.max(
          18,
          ((segment.end - segment.start) / 60) * HOUR_HEIGHT,
        );
        return (
          <div
            key={event.id}
            className="absolute z-10 px-0.5 py-px"
            style={{ top, height, left: `${left}%`, width: `${width}%` }}
          >
            <EventChip
              event={event}
              timezone={timezone}
              className="h-full w-full overflow-hidden"
              dragging={draggingEventId === event.id}
              dragHandlers={{
                onPointerDown: (pointer) =>
                  onEventPointerDown(event, "move", pointer),
              }}
              resizeHandle={
                isDraggable(editing, event) ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                    onPointerDown={(pointer) =>
                      onEventPointerDown(event, "resize", pointer)
                    }
                  />
                ) : null
              }
            />
          </div>
        );
      })}
      {createPreview ? (
        <div
          className="pointer-events-none absolute inset-x-0.5 z-10 rounded-md border border-primary/50 bg-primary/15"
          style={{
            top: (createPreview.start / 60) * HOUR_HEIGHT,
            height:
              ((createPreview.end - createPreview.start) / 60) * HOUR_HEIGHT,
          }}
        />
      ) : null}
      {showCurrentTime ? (
        <div
          className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-primary"
          style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
        >
          <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-primary" />
        </div>
      ) : null}
    </div>
  );
}

function MonthView({
  dateKeys,
  events,
  timezone,
  todayKey,
}: {
  dateKeys: string[];
  events: CalendarEvent[];
  timezone: string;
  todayKey: string;
}) {
  const editing = useCalendarEditing();
  const dragRef = useRef<{ event: CalendarEvent; fromKey: string } | null>(
    null,
  );
  const [dropKey, setDropKey] = useState<string | null>(null);
  const byDay = useMemo(
    () => groupEventsByDay(events, dateKeys, timezone),
    [events, dateKeys, timezone],
  );
  const anchorMonth = dateKeys[Math.floor(dateKeys.length / 2)].slice(0, 7);
  const weekdays = dateKeys.slice(0, 7);

  const drop = (toKey: string) => {
    const dragged = dragRef.current;
    dragRef.current = null;
    setDropKey(null);
    if (!editing || !dragged) return;
    const dayDelta = diffDateKeys(dragged.fromKey, toKey);
    if (dayDelta === 0) return;
    const { event } = dragged;
    if (event.isAllDay) {
      const moved = moveEventByDays({
        event: { isAllDay: true, startDate: event.start, endDate: event.end },
        dayDelta,
        timeZone: timezone,
      });
      if (moved.isAllDay) editing.moveAllDay(event, moved);
      return;
    }
    const moved = moveEventByDays({
      event: {
        isAllDay: false,
        start: new Date(event.start),
        end: new Date(event.end),
      },
      dayDelta,
      timeZone: timezone,
    });
    if (!moved.isAllDay) editing.moveTimed(event, moved);
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-card">
      <div className="grid min-w-[700px] grid-cols-7 border-b border-border">
        {weekdays.map((dateKey) => (
          <div
            key={dateKey}
            className="border-l border-border px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground first:border-l-0"
          >
            {new Intl.DateTimeFormat(undefined, {
              weekday: "short",
              timeZone: "UTC",
            }).format(dateFromKey(dateKey))}
          </div>
        ))}
      </div>
      <div className="grid min-w-[700px] grid-cols-7">
        {dateKeys.map((dateKey) => {
          const dayEvents = byDay.get(dateKey) ?? [];
          return (
            <MonthCell
              key={dateKey}
              dateKey={dateKey}
              anchorMonth={anchorMonth}
              today={dateKey === todayKey}
              isDropTarget={dropKey === dateKey}
              dayEvents={dayEvents}
              timezone={timezone}
              onCreate={editing?.create}
              onChipDragStart={(event) => {
                dragRef.current = { event, fromKey: dateKey };
              }}
              onDragOver={(dragEvent, hasPayload) => {
                if (!hasPayload) return;
                dragEvent.preventDefault();
                dragEvent.dataTransfer.dropEffect = "move";
                if (dropKey !== dateKey) setDropKey(dateKey);
              }}
              onDrop={(dragEvent) => {
                dragEvent.preventDefault();
                drop(dateKey);
              }}
              onDropEnd={() => {
                dragRef.current = null;
                setDropKey(null);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function MonthCell({
  dateKey,
  anchorMonth,
  today,
  isDropTarget,
  dayEvents,
  timezone,
  onCreate,
  onChipDragStart,
  onDragOver,
  onDrop,
  onDropEnd,
}: {
  dateKey: string;
  anchorMonth: string;
  today: boolean;
  isDropTarget: boolean;
  dayEvents: CalendarEvent[];
  timezone: string;
  onCreate: CalendarEditing["create"] | undefined;
  onChipDragStart: (event: CalendarEvent) => void;
  onDragOver: (dragEvent: React.DragEvent, hasPayload: boolean) => void;
  onDrop: (dragEvent: React.DragEvent) => void;
  onDropEnd: () => void;
}) {
  const editing = useCalendarEditing();

  return (
    <div
      className={cn(
        "min-h-28 border-b border-l border-border p-1.5 first:border-l-0",
        isDropTarget && "bg-accent",
      )}
      onClick={(clickEvent) => {
        if ((clickEvent.target as HTMLElement).closest("button")) return;
        onCreate?.({ startDate: dateKey, endDate: dateKey });
      }}
      onDragOver={(dragEvent) =>
        onDragOver(
          dragEvent,
          dragEvent.dataTransfer.types.includes("text/plain"),
        )
      }
      onDrop={onDrop}
      onKeyUp={(keyEvent) => {
        if (keyEvent.key !== "Enter") return;
        if ((keyEvent.target as HTMLElement).closest("button")) return;
        onCreate?.({ startDate: dateKey, endDate: dateKey });
      }}
    >
      <div
        className={cn(
          "mb-1 flex size-6 items-center justify-center rounded-full text-xs font-medium",
          !dateKey.startsWith(anchorMonth) && "text-muted-foreground/60",
          today && "bg-primary text-primary-foreground",
        )}
      >
        {dateFromKey(dateKey).getUTCDate()}
      </div>
      <div className="space-y-1">
        {dayEvents.slice(0, 3).map((event) => (
          <EventChip
            key={event.id}
            event={event}
            timezone={timezone}
            compact
            className="block w-full"
            dragHandlers={{
              draggable: isDraggable(editing, event),
              onDragStart: (dragEvent) => {
                onChipDragStart(event);
                dragEvent.dataTransfer.effectAllowed = "move";
                dragEvent.dataTransfer.setData("text/plain", event.id);
              },
              onDragEnd: onDropEnd,
            }}
          />
        ))}
        {dayEvents.length > 3 ? (
          <div className="px-1 text-[11px] text-muted-foreground">
            +{dayEvents.length - 3} more
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AgendaView({
  dateKeys,
  events,
  timezone,
  todayKey,
}: {
  dateKeys: string[];
  events: CalendarEvent[];
  timezone: string;
  todayKey: string;
}) {
  const byDay = useMemo(
    () => groupEventsByDay(events, dateKeys, timezone),
    [events, dateKeys, timezone],
  );
  const daysWithEvents = dateKeys.filter(
    (dateKey) => (byDay.get(dateKey)?.length ?? 0) > 0,
  );

  if (daysWithEvents.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-card p-8 text-sm text-muted-foreground">
        No events
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-card">
      <div className="mx-auto max-w-4xl divide-y divide-border px-4 lg:px-8">
        {daysWithEvents.map((dateKey) => (
          <section
            key={dateKey}
            className="grid gap-3 py-5 sm:grid-cols-[9rem_1fr]"
          >
            <div>
              <div
                className={cn(
                  "font-semibold",
                  dateKey === todayKey && "text-primary",
                )}
              >
                {new Intl.DateTimeFormat(undefined, {
                  weekday: "long",
                  timeZone: "UTC",
                }).format(dateFromKey(dateKey))}
              </div>
              <div className="text-sm text-muted-foreground">
                {new Intl.DateTimeFormat(undefined, {
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                }).format(dateFromKey(dateKey))}
              </div>
            </div>
            <div className="space-y-2">
              {(byDay.get(dateKey) ?? []).map((event) => (
                <div
                  key={event.id}
                  className="grid grid-cols-[5rem_1fr] items-start gap-2"
                >
                  <div className="pt-1 text-xs text-muted-foreground">
                    {event.isAllDay
                      ? "All day"
                      : formatEventTime(event.start, timezone)}
                  </div>
                  <EventChip
                    event={event}
                    timezone={timezone}
                    compact
                    className="w-full py-2"
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function dateFromKey(dateKey: string) {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

function formatHour(hour: number) {
  // The date is irrelevant; UTC plus UTC formatting yields locale-appropriate
  // hour labels while preserving the requested wall-clock hour.
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, 0, 1, hour)));
}

function formatEventTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

function getColumnRects(grid: HTMLElement | null) {
  return Array.from(
    grid?.querySelectorAll<HTMLElement>("[data-day-column]") ?? [],
  ).map((element) => element.getBoundingClientRect());
}

function isPrimaryPointer(pointerEvent: React.PointerEvent) {
  return pointerEvent.button === 0 && pointerEvent.pointerType !== "touch";
}

/** Recurring events and calendars that cannot be written to stay put. */
function isDraggable(editing: CalendarEditing | null, event: CalendarEvent) {
  return (
    editing !== null &&
    !event.isRecurring &&
    editing.getEventBlock(event) === null
  );
}

function applyChange(event: CalendarEvent, change: EventChange): CalendarEvent {
  return change.kind === "timed"
    ? {
        ...event,
        start: change.start.toISOString(),
        end: change.end.toISOString(),
      }
    : { ...event, start: change.startDate, end: change.endDate };
}

/**
 * Where a gesture stands for the pointer at `x`, `y`. A gesture stays pending
 * until the pointer has moved a few pixels, so a plain click still opens the
 * popover.
 */
function evaluateGesture({
  gesture,
  x,
  y,
  columns,
  dateKeys,
  timezone,
}: {
  gesture: Gesture;
  x: number;
  y: number;
  columns: DOMRect[];
  dateKeys: string[];
  timezone: string;
}): GestureResult {
  if (gesture.kind === "create") {
    const column = columns[dateKeys.indexOf(gesture.dateKey)];
    if (!column) return { kind: "pending" };
    if (!gesture.active && Math.abs(y - gesture.startY) <= DRAG_THRESHOLD_PX) {
      return { kind: "pending" };
    }
    const pointerMinutes = pixelsToMinutes({
      pointerY: y,
      columnTop: column.top,
      hourHeight: HOUR_HEIGHT,
    });
    return {
      kind: "create",
      pointerMinutes,
      ...computeCreateRangeMinutes(gesture.anchor, pointerMinutes),
    };
  }

  const distance =
    gesture.kind === "move"
      ? Math.hypot(x - gesture.startX, y - gesture.startY)
      : gesture.kind === "resize"
        ? Math.abs(y - gesture.startY)
        : Math.abs(x - gesture.startX);
  if (!gesture.active && distance <= DRAG_THRESHOLD_PX) {
    return { kind: "pending" };
  }

  const { event } = gesture;
  if (gesture.kind === "moveAllDay") {
    const dayDelta = findColumnIndex(x, columns) - gesture.originIndex;
    const moved = moveEventByDays({
      event: { isAllDay: true, startDate: event.start, endDate: event.end },
      dayDelta,
      timeZone: timezone,
    });
    return moved.isAllDay
      ? { kind: "event", change: { kind: "allDay", ...moved } }
      : { kind: "pending" };
  }

  const start = new Date(event.start);
  const end = new Date(event.end);
  const verticalMinutes = ((y - gesture.startY) / HOUR_HEIGHT) * 60;
  if (gesture.kind === "resize") {
    const resized = resizeTimedEvent({
      start,
      end,
      timeZone: timezone,
      deltaMinutes: verticalMinutes,
    });
    return { kind: "event", change: { kind: "timed", ...resized } };
  }
  const dayDelta = findColumnIndex(x, columns) - gesture.originIndex;
  const moved = moveTimedEvent({
    start,
    end,
    timeZone: timezone,
    deltaMinutes: dayDelta * MINUTES_PER_DAY + verticalMinutes,
  });
  return { kind: "event", change: { kind: "timed", ...moved } };
}

function commitChange(
  editing: CalendarEditing,
  gesture: Exclude<Gesture, { kind: "create" }>,
  change: EventChange,
) {
  const { event } = gesture;
  if (change.kind === "allDay") {
    if (change.startDate !== event.start) editing.moveAllDay(event, change);
    return;
  }
  if (gesture.kind === "resize") {
    if (change.end.getTime() !== new Date(event.end).getTime()) {
      editing.resizeTimed(event, change.end);
    }
    return;
  }
  if (change.start.getTime() !== new Date(event.start).getTime()) {
    editing.moveTimed(event, change);
  }
}
