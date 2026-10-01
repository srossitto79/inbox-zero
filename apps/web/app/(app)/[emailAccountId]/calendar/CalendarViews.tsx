"use client";

import { useEffect, useMemo, useState } from "react";
import type { GetCalendarEventsResponse } from "@/app/api/user/calendar/events/route";
import { cn } from "@/utils";
import {
  type CalendarViewType,
  getDaySegment,
  groupEventsByDay,
} from "@/utils/calendar/event-range";
import { layoutDayEvents } from "@/utils/calendar/event-layout";
import { toWallClock } from "@/utils/calendar/zoned-time";
import { EventChip } from "./CalendarEventPopover";

type CalendarEvent = GetCalendarEventsResponse["events"][number];

const HOUR_HEIGHT = 64;
const DAY_HEIGHT = 24 * HOUR_HEIGHT;
const DAY_MIN_WIDTH = 128;
const TIME_GUTTER = 64;

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
  const byDay = useMemo(
    () => groupEventsByDay(events, dateKeys, timezone),
    [events, dateKeys, timezone],
  );
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const nowWall = toWallClock(now, timezone);
  const nowMinutes = nowWall.hour * 60 + nowWall.minute;
  const minWidth = TIME_GUTTER + dateKeys.length * DAY_MIN_WIDTH;
  const columns = `${TIME_GUTTER}px repeat(${dateKeys.length}, minmax(${DAY_MIN_WIDTH}px, 1fr))`;

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-card">
      <div style={{ minWidth }}>
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
            <div
              key={dateKey}
              className="min-w-0 space-y-1 border-l border-border p-1"
            >
              {(byDay.get(dateKey) ?? [])
                .filter((event) => event.isAllDay)
                .map((event) => (
                  <EventChip
                    key={event.id}
                    event={event}
                    timezone={timezone}
                    compact
                    className="block w-full"
                  />
                ))}
            </div>
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
            />
          ))}
        </div>
      </div>
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
}: {
  dateKey: string;
  events: CalendarEvent[];
  timezone: string;
  showCurrentTime: boolean;
  nowMinutes: number;
}) {
  const segments = events.map((event) => ({
    id: event.id,
    ...getDaySegment(event, dateKey, timezone),
  }));
  const placements = new Map(
    layoutDayEvents(segments).map((placement) => [placement.id, placement]),
  );

  return (
    <div
      className="relative border-l border-border"
      style={{ height: DAY_HEIGHT }}
    >
      {Array.from({ length: 24 }, (_, hour) => (
        <div
          key={hour}
          className="absolute inset-x-0 border-t border-border/70"
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
            />
          </div>
        );
      })}
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
  const byDay = useMemo(
    () => groupEventsByDay(events, dateKeys, timezone),
    [events, dateKeys, timezone],
  );
  const anchorMonth = dateKeys[Math.floor(dateKeys.length / 2)].slice(0, 7);
  const weekdays = dateKeys.slice(0, 7);

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
            <div
              key={dateKey}
              className="min-h-28 border-b border-l border-border p-1.5 first:border-l-0"
            >
              <div
                className={cn(
                  "mb-1 flex size-6 items-center justify-center rounded-full text-xs font-medium",
                  !dateKey.startsWith(anchorMonth) &&
                    "text-muted-foreground/60",
                  dateKey === todayKey && "bg-primary text-primary-foreground",
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
        })}
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
