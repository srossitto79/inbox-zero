import { describe, expect, it } from "vitest";
import type { CalendarViewEvent } from "@/utils/calendar/expand-events";
import {
  removeEvent,
  replaceEvent,
  setEventTimes,
  setSelfResponse,
} from "@/utils/calendar/optimistic-events";

function event(id: string, overrides: Partial<CalendarViewEvent> = {}) {
  return {
    id: `row-${id}`,
    calendarId: "cal-1",
    providerEventId: id,
    title: id,
    start: "2026-10-05T07:00:00.000Z",
    end: "2026-10-05T08:00:00.000Z",
    attendees: [],
    selfResponseStatus: null,
    ...overrides,
  } as CalendarViewEvent;
}

const key = { calendarId: "cal-1", providerEventId: "a" };

describe("optimistic event edits", () => {
  const events = [event("a"), event("b")];

  it("moves only the matching event", () => {
    const next = setEventTimes(events, key, {
      start: "2026-10-06T07:00:00.000Z",
      end: "2026-10-06T08:00:00.000Z",
    });

    expect(next[0].start).toBe("2026-10-06T07:00:00.000Z");
    expect(next[1]).toBe(events[1]);
  });

  it("does not confuse the same provider id in another calendar", () => {
    const other = event("a", { calendarId: "cal-2" });

    expect(removeEvent([events[0], other], key)).toEqual([other]);
  });

  it("changes the viewer's answer in the guest list too", () => {
    const next = setSelfResponse(
      [
        event("a", {
          selfResponseStatus: "needsAction",
          attendees: [
            { email: "me@example.com", isSelf: true },
            { email: "x@example.com", responseStatus: "declined" },
          ],
        }),
      ],
      key,
      "accepted",
    );

    expect(next[0].selfResponseStatus).toBe("accepted");
    expect(next[0].attendees).toEqual([
      { email: "me@example.com", isSelf: true, responseStatus: "accepted" },
      { email: "x@example.com", responseStatus: "declined" },
    ]);
  });

  it("replaces an event with the server's copy", () => {
    const fresh = event("a", { title: "Fresh" });

    expect(replaceEvent(events, fresh)[0].title).toBe("Fresh");
  });
});
