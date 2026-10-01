"use client";

import {
  CalendarClockIcon,
  ExternalLinkIcon,
  MapPinIcon,
  UsersIcon,
  VideoIcon,
} from "lucide-react";
import type { GetCalendarEventsResponse } from "@/app/api/user/calendar/events/route";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/utils";

type CalendarEvent = GetCalendarEventsResponse["events"][number];

export function CalendarEventPopover({
  event,
  timezone,
  children,
}: {
  event: CalendarEvent;
  timezone: string;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-4 p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-1 size-3 shrink-0 rounded-full bg-[var(--calendar-color)]"
            style={eventColor(event.calendarColor)}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold leading-snug">{event.title}</h2>
              {event.status === "TENTATIVE" ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Tentative
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {event.calendarName}
            </p>
          </div>
        </div>

        <Detail icon={CalendarClockIcon}>
          {formatEventTime(event, timezone)}
        </Detail>
        {event.location ? (
          <Detail icon={MapPinIcon}>{event.location}</Detail>
        ) : null}
        {event.attendees.length > 0 ? (
          <Detail icon={UsersIcon}>
            <div className="space-y-2">
              {event.attendees.slice(0, 8).map((attendee) => (
                <div key={attendee.email} className="flex items-center gap-2">
                  <InitialsAvatar
                    name={attendee.name || attendee.email}
                    seed={attendee.email}
                    size="xs"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">
                      {attendee.name || attendee.email}
                    </div>
                    {attendee.name ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {attendee.email}
                      </div>
                    ) : null}
                  </div>
                  {attendee.responseStatus ? (
                    <span className="text-xs capitalize text-muted-foreground">
                      {formatResponse(attendee.responseStatus)}
                    </span>
                  ) : null}
                </div>
              ))}
              {event.attendees.length > 8 ? (
                <p className="text-xs text-muted-foreground">
                  +{event.attendees.length - 8} more
                </p>
              ) : null}
            </div>
          </Detail>
        ) : null}

        {event.description ? (
          <p className="max-h-28 overflow-y-auto whitespace-pre-wrap border-t border-border pt-3 text-sm text-muted-foreground">
            {event.description}
          </p>
        ) : null}

        {event.videoLink || event.htmlLink ? (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {event.videoLink ? (
              <a
                href={event.videoLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                <VideoIcon className="size-3.5" />
                Join video
              </a>
            ) : null}
            {event.htmlLink ? (
              <a
                href={event.htmlLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-accent"
              >
                <ExternalLinkIcon className="size-3.5" />
                Open in provider
              </a>
            ) : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function eventColor(color: string | null) {
  return {
    "--calendar-color": color ?? "hsl(var(--queue-calendar))",
  } as React.CSSProperties;
}

export function EventChip({
  event,
  timezone,
  compact = false,
  className,
}: {
  event: CalendarEvent;
  timezone: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <CalendarEventPopover event={event} timezone={timezone}>
      <button
        type="button"
        className={cn(
          "min-w-0 rounded-md border-l-[3px] border-[var(--calendar-color)] bg-[color-mix(in_srgb,var(--calendar-color)_14%,transparent)] px-1.5 py-1 text-left text-foreground outline-none hover:bg-[color-mix(in_srgb,var(--calendar-color)_22%,transparent)] focus-visible:ring-2 focus-visible:ring-ring",
          event.status === "TENTATIVE" && "opacity-70",
          compact && "py-0.5 text-xs",
          className,
        )}
        style={eventColor(event.calendarColor)}
        aria-label={`${event.title}, ${formatEventTime(event, timezone)}`}
      >
        <span className="block truncate font-medium leading-tight">
          {event.title}
        </span>
        {!compact && !event.isAllDay ? (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {formatTime(event.start, timezone)}
          </span>
        ) : null}
      </button>
    </CalendarEventPopover>
  );
}

function Detail({
  icon: Icon,
  children,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function formatEventTime(event: CalendarEvent, timezone: string) {
  if (event.isAllDay) {
    const start = dateFromKey(event.start);
    const end = new Date(dateFromKey(event.end).getTime() - 86_400_000);
    const format = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    return start.getTime() === end.getTime()
      ? `${format.format(start)} · All day`
      : `${format.format(start)} – ${format.format(end)} · All day`;
  }

  const start = new Date(event.start);
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  });
  return `${day.format(start)}, ${formatTime(event.start, timezone)} – ${formatTime(event.end, timezone)}`;
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function formatResponse(response: string) {
  if (response === "needsAction") return "Awaiting";
  return response;
}
