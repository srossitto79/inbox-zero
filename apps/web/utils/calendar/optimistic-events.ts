import type { CalendarViewEvent } from "@/utils/calendar/expand-events";

type EventKey = Pick<CalendarViewEvent, "calendarId" | "providerEventId">;

/**
 * Edits to the cached event list while a write is in flight. They only touch
 * the one event, so the list the server sends back replaces them cleanly.
 */

export function setEventTimes(
  events: CalendarViewEvent[],
  key: EventKey,
  times: Pick<CalendarViewEvent, "start" | "end">,
) {
  return events.map((event) =>
    isSameEvent(event, key) ? { ...event, ...times } : event,
  );
}

export function removeEvent(events: CalendarViewEvent[], key: EventKey) {
  return events.filter((event) => !isSameEvent(event, key));
}

export function setSelfResponse(
  events: CalendarViewEvent[],
  key: EventKey,
  response: string,
) {
  return events.map((event) =>
    isSameEvent(event, key)
      ? {
          ...event,
          selfResponseStatus: response,
          attendees: event.attendees.map((attendee) =>
            attendee.isSelf
              ? { ...attendee, responseStatus: response }
              : attendee,
          ),
        }
      : event,
  );
}

export function replaceEvent(
  events: CalendarViewEvent[],
  next: CalendarViewEvent,
) {
  return events.map((event) => (isSameEvent(event, next) ? next : event));
}

function isSameEvent(event: EventKey, key: EventKey) {
  return (
    event.calendarId === key.calendarId &&
    event.providerEventId === key.providerEventId
  );
}
