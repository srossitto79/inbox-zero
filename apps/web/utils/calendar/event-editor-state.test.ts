import { describe, expect, it } from "vitest";
import type { CalendarViewEvent } from "@/utils/calendar/expand-events";
import {
  addGuests,
  createEditorState,
  editorStateToCreatePayload,
  editorStateToTiming,
  editorStateToUpdatePayload,
  eventToEditorState,
  getEditorProblem,
  parseGuestInput,
  withStart,
} from "@/utils/calendar/event-editor-state";

const ROME = "Europe/Rome";

function viewEvent(
  overrides: Partial<CalendarViewEvent> = {},
): CalendarViewEvent {
  return {
    id: "row-1",
    calendarId: "cal-1",
    calendarName: "Work",
    calendarColor: null,
    providerEventId: "evt1",
    recurringEventId: null,
    isRecurring: false,
    title: "Planning",
    description: null,
    location: null,
    isAllDay: false,
    start: "2026-10-05T07:00:00.000Z",
    end: "2026-10-05T08:00:00.000Z",
    timezone: ROME,
    status: "CONFIRMED",
    isBusy: true,
    organizer: { email: "me@example.com", name: null, isSelf: true },
    attendees: [],
    selfResponseStatus: null,
    videoLink: null,
    htmlLink: null,
    reminders: null,
    ...overrides,
  };
}

describe("createEditorState", () => {
  it("reads a dragged range in the editor's zone", () => {
    const state = createEditorState({
      calendarId: "cal-1",
      timeZone: ROME,
      range: {
        start: new Date("2026-10-05T07:00:00Z"),
        end: new Date("2026-10-05T08:30:00Z"),
      },
    });

    expect(state).toMatchObject({
      isAllDay: false,
      startDate: "2026-10-05",
      startTime: "09:00",
      endDate: "2026-10-05",
      endTime: "10:30",
      reminders: { useDefault: true, overrides: [] },
      sendInvitations: true,
    });
  });

  it("creates an all-day state from dates", () => {
    const state = createEditorState({
      calendarId: "cal-1",
      timeZone: ROME,
      range: { startDate: "2026-10-26", endDate: "2026-10-26" },
    });

    expect(state).toMatchObject({ isAllDay: true, startDate: "2026-10-26" });
  });
});

describe("eventToEditorState", () => {
  it("shows an all-day event with an inclusive end", () => {
    const state = eventToEditorState(
      viewEvent({ isAllDay: true, start: "2026-10-05", end: "2026-10-08" }),
      ROME,
    );

    expect(state).toMatchObject({
      isAllDay: true,
      startDate: "2026-10-05",
      endDate: "2026-10-07",
    });
  });

  it("uses the event's zone, and only the editable guests", () => {
    const state = eventToEditorState(
      viewEvent({
        timezone: "America/New_York",
        attendees: [
          { email: "me@example.com", isSelf: true },
          { email: "host@example.com", isOrganizer: true },
          { email: "a@example.com" },
        ],
      }),
      ROME,
    );

    expect(state).toMatchObject({
      timeZone: "America/New_York",
      startTime: "03:00",
      guests: ["a@example.com"],
    });
  });

  it("falls back to the viewer's zone and default reminders", () => {
    const state = eventToEditorState(viewEvent({ timezone: null }), ROME);

    expect(state.timeZone).toBe(ROME);
    expect(state.reminders).toEqual({ useDefault: true, overrides: [] });
  });

  it("carries custom reminders", () => {
    const state = eventToEditorState(
      viewEvent({
        reminders: {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 10 },
            { method: "sms", minutes: 5 },
          ],
        },
      }),
      ROME,
    );

    expect(state.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 10 }],
    });
  });
});

describe("editorStateToTiming", () => {
  it("converts wall-clock fields to instants in the chosen zone", () => {
    const state = eventToEditorState(viewEvent(), ROME);

    expect(editorStateToTiming(state)).toEqual({
      isAllDay: false,
      start: "2026-10-05T07:00:00.000Z",
      end: "2026-10-05T08:00:00.000Z",
      timeZone: ROME,
    });
  });

  it("makes the end of an all-day event exclusive", () => {
    const state = createEditorState({
      calendarId: "cal-1",
      timeZone: ROME,
      range: { startDate: "2026-10-30", endDate: "2026-10-31" },
    });

    expect(editorStateToTiming(state)).toEqual({
      isAllDay: true,
      startDate: "2026-10-30",
      endDate: "2026-11-01",
    });
  });

  it("follows the zone, not the browser, when the zone is changed", () => {
    const state = {
      ...eventToEditorState(viewEvent(), ROME),
      timeZone: "America/New_York",
    };

    expect(editorStateToTiming(state)).toMatchObject({
      start: "2026-10-05T13:00:00.000Z",
    });
  });

  it("puts a time inside the spring-forward gap after the gap", () => {
    const state = {
      ...eventToEditorState(viewEvent(), ROME),
      startDate: "2026-03-29",
      startTime: "02:30",
      endDate: "2026-03-29",
      endTime: "04:00",
    };

    expect(editorStateToTiming(state)).toMatchObject({
      start: "2026-03-29T01:30:00.000Z", // 03:30 CEST
      end: "2026-03-29T02:00:00.000Z",
    });
  });
});

describe("getEditorProblem", () => {
  const base = eventToEditorState(viewEvent(), ROME);

  it("accepts a valid state", () => {
    expect(getEditorProblem(base)).toBeNull();
  });

  it("flags an end that is not after the start", () => {
    expect(getEditorProblem({ ...base, endTime: "09:00" })).toBe(
      "End must be after start",
    );
    expect(getEditorProblem({ ...base, endTime: "08:00" })).toBe(
      "End must be after start",
    );
  });

  it("allows an event that ends the next day", () => {
    expect(
      getEditorProblem({
        ...base,
        startTime: "22:00",
        endDate: "2026-10-06",
        endTime: "01:00",
      }),
    ).toBeNull();
  });

  it("allows a one-day all-day event and rejects a backwards one", () => {
    const allDay = { ...base, isAllDay: true };
    expect(getEditorProblem(allDay)).toBeNull();
    expect(getEditorProblem({ ...allDay, endDate: "2026-10-04" })).toBe(
      "End must be after start",
    );
  });

  it("flags bad guests, zones and dates", () => {
    expect(getEditorProblem({ ...base, guests: ["nope"] })).toBe(
      "Invalid email",
    );
    expect(getEditorProblem({ ...base, timeZone: "Mars/Base" })).toBe(
      "Invalid time zone",
    );
    expect(getEditorProblem({ ...base, startDate: "" })).toBe("Invalid date");
    expect(getEditorProblem({ ...base, startTime: "25:00" })).toBe(
      "Invalid date",
    );
  });
});

describe("editorStateToCreatePayload", () => {
  it("invites guests only when asked to", () => {
    const state = {
      ...createEditorState({
        calendarId: "cal-1",
        timeZone: ROME,
        range: {
          start: new Date("2026-10-05T07:00:00Z"),
          end: new Date("2026-10-05T08:00:00Z"),
        },
      }),
      title: "  Lunch  ",
      guests: ["a@example.com"],
    };

    expect(editorStateToCreatePayload(state)).toMatchObject({
      calendarId: "cal-1",
      title: "Lunch",
      guests: [{ email: "a@example.com" }],
      sendUpdates: "all",
    });
    expect(
      editorStateToCreatePayload({ ...state, sendInvitations: false }),
    ).toMatchObject({ sendUpdates: "none" });
    expect(editorStateToCreatePayload({ ...state, guests: [] })).toMatchObject({
      sendUpdates: "none",
    });
  });
});

describe("editorStateToUpdatePayload", () => {
  const initial = eventToEditorState(
    viewEvent({ attendees: [{ email: "a@example.com" }] }),
    ROME,
  );

  it("returns null when nothing changed", () => {
    expect(
      editorStateToUpdatePayload({
        initial,
        current: { ...initial },
        providerEventId: "evt1",
      }),
    ).toBeNull();
  });

  it("sends only the changed fields", () => {
    const payload = editorStateToUpdatePayload({
      initial,
      current: { ...initial, title: "Renamed", location: "Room 2" },
      providerEventId: "evt1",
    });

    expect(payload).toEqual({
      calendarId: "cal-1",
      providerEventId: "evt1",
      title: "Renamed",
      location: "Room 2",
      sendUpdates: "all",
    });
  });

  it("leaves the time out when only other fields changed", () => {
    // Inside the repeated hour of 2026-10-25 the wall clock alone cannot say
    // which of the two 02:30s it is, so the time must not be re-sent.
    const fold = eventToEditorState(
      viewEvent({
        start: "2026-10-25T01:30:00.000Z", // 02:30 CET, the second one
        end: "2026-10-25T02:30:00.000Z",
      }),
      ROME,
    );
    const payload = editorStateToUpdatePayload({
      initial: fold,
      current: { ...fold, title: "Renamed" },
      providerEventId: "evt1",
    });

    expect(payload).not.toHaveProperty("timing");
  });

  it("sends the new time and the guest list when they change", () => {
    const payload = editorStateToUpdatePayload({
      initial,
      current: {
        ...initial,
        startTime: "10:00",
        endTime: "11:00",
        guests: ["a@example.com", "b@example.com"],
      },
      providerEventId: "evt1",
    });

    expect(payload).toMatchObject({
      timing: {
        isAllDay: false,
        start: "2026-10-05T08:00:00.000Z",
        end: "2026-10-05T09:00:00.000Z",
      },
      guests: [{ email: "a@example.com" }, { email: "b@example.com" }],
    });
  });

  it("treats a reordered or re-cased guest list as unchanged", () => {
    const two = { ...initial, guests: ["a@example.com", "b@example.com"] };
    expect(
      editorStateToUpdatePayload({
        initial: two,
        current: { ...two, guests: ["B@example.com", "a@example.com"] },
        providerEventId: "evt1",
      }),
    ).toBeNull();
  });

  it("asks for a Meet link only when it is newly requested", () => {
    expect(
      editorStateToUpdatePayload({
        initial,
        current: { ...initial, addVideoConference: true },
        providerEventId: "evt1",
      }),
    ).toMatchObject({ addVideoConference: true });
  });

  it("stays quiet when there are no guests", () => {
    const solo = eventToEditorState(viewEvent(), ROME);
    expect(
      editorStateToUpdatePayload({
        initial: solo,
        current: { ...solo, title: "x" },
        providerEventId: "evt1",
      }),
    ).toMatchObject({ sendUpdates: "none" });
  });

  it("converts to all-day and back", () => {
    const payload = editorStateToUpdatePayload({
      initial,
      current: { ...initial, isAllDay: true },
      providerEventId: "evt1",
    });

    expect(payload?.timing).toEqual({
      isAllDay: true,
      startDate: "2026-10-05",
      endDate: "2026-10-06",
    });
  });
});

describe("withStart", () => {
  const base = eventToEditorState(viewEvent(), ROME);

  it("moves the end with the start", () => {
    const next = withStart(base, { startTime: "14:30" });

    expect(next).toMatchObject({ startTime: "14:30", endTime: "15:30" });
  });

  it("carries the end over midnight", () => {
    const next = withStart(base, { startTime: "23:30" });

    expect(next).toMatchObject({ endDate: "2026-10-06", endTime: "00:30" });
  });

  it("keeps the elapsed length across a DST change", () => {
    const next = withStart(base, {
      startDate: "2026-10-25",
      startTime: "01:30",
    });

    // 01:30 CEST plus one elapsed hour is still 02:30 CEST, before the clocks
    // fall back at 03:00.
    expect(next.endDate).toBe("2026-10-25");
    expect(next.endTime).toBe("02:30");
  });

  it("shifts an all-day range by the same number of days", () => {
    const allDay = {
      ...base,
      isAllDay: true,
      startDate: "2026-10-05",
      endDate: "2026-10-07",
    };

    expect(withStart(allDay, { startDate: "2026-10-30" })).toMatchObject({
      startDate: "2026-10-30",
      endDate: "2026-11-01",
    });
  });

  it("does not guess while a field is incomplete", () => {
    expect(withStart(base, { startTime: "" })).toMatchObject({
      startTime: "",
      endTime: "10:00",
    });
  });
});

describe("guest input", () => {
  it("splits pasted lists and keeps invalid tokens apart", () => {
    expect(
      parseGuestInput("a@example.com, <b@example.com>; nope c@example.com"),
    ).toEqual({
      valid: ["a@example.com", "b@example.com", "c@example.com"],
      invalid: ["nope"],
    });
  });

  it("does not add the same address twice", () => {
    expect(
      addGuests(["a@example.com"], ["A@example.com", "b@example.com"]),
    ).toEqual(["a@example.com", "b@example.com"]);
  });
});
