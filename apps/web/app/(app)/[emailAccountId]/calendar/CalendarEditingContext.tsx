"use client";

import { createContext, useContext } from "react";
import type { GetCalendarEventsResponse } from "@/app/api/user/calendar/events/route";
import type { WriteBlock } from "@/utils/calendar/write/policy";

type CalendarEvent = GetCalendarEventsResponse["events"][number];

/** Where a new event goes; an all-day range ends on its last day (inclusive). */
export type CreateRange =
  | { start: Date; end: Date }
  | { startDate: string; endDate: string };

export type CalendarEditing = {
  /** Reconnect and similar blocks that apply to creating anywhere. */
  createBlock: WriteBlock | null;
  /** Why the event cannot be written to, or null when it can be edited. */
  getEventBlock: (event: CalendarEvent) => WriteBlock | null;
  setFocusedEventId: (id: string | null) => void;
  setOpenEventId: (id: string | null) => void;
  create: (range: CreateRange) => void;
  edit: (event: CalendarEvent) => void;
  remove: (event: CalendarEvent) => void;
  respond: (
    event: CalendarEvent,
    response: "accepted" | "declined" | "tentative",
  ) => void;
  moveTimed: (event: CalendarEvent, times: { start: Date; end: Date }) => void;
  resizeTimed: (event: CalendarEvent, end: Date) => void;
  moveAllDay: (
    event: CalendarEvent,
    dates: { startDate: string; endDate: string },
  ) => void;
};

export const CalendarEditingContext = createContext<CalendarEditing | null>(
  null,
);

/** Null outside the provider, where the views stay read-only. */
export function useCalendarEditing() {
  return useContext(CalendarEditingContext);
}
