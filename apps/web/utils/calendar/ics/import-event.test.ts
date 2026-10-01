import { describe, expect, it } from "vitest";
import { getEditorProblem } from "@/utils/calendar/event-editor-state";
import type { ParsedIcsEvent } from "./parse-ics";
import { parsedIcsToEditorState } from "./import-event";

function parsed(overrides: Partial<ParsedIcsEvent>): ParsedIcsEvent {
  return {
    uid: "uid",
    title: "Meeting",
    description: null,
    location: null,
    start: new Date("2026-10-05T09:00:00Z"),
    end: new Date("2026-10-05T10:00:00Z"),
    isAllDay: false,
    timeZone: null,
    status: "CONFIRMED",
    isBusy: true,
    recurrence: [],
    recurrenceId: null,
    organizer: null,
    attendees: [],
    reminders: [],
    url: null,
    ...overrides,
  };
}

const base = { calendarId: "cal-1", viewerTimeZone: "Europe/Rome" };

describe("parsedIcsToEditorState", () => {
  it("keeps a UTC timed event in the viewer's zone", () => {
    const state = parsedIcsToEditorState({
      ...base,
      event: parsed({
        organizer: { email: "me@example.com", name: null },
        attendees: [
          { email: "a@example.com", name: null, responseStatus: "accepted" },
          { email: "me@example.com", name: null, responseStatus: "accepted" },
        ],
      }),
    });
    expect(state.isAllDay).toBe(false);
    // 09:00 UTC is 11:00 in Rome; the editor edits the event's own zone.
    expect(state.startDate).toBe("2026-10-05");
    expect(state.startTime).toBe("11:00");
    expect(state.endTime).toBe("12:00");
    expect(state.timeZone).toBe("Europe/Rome");
    expect(state.guests).toEqual(["a@example.com"]);
    expect(state.sendInvitations).toBe(true);
    expect(getEditorProblem(state)).toBeNull();
  });

  it("keeps the event's own zone when the file declares one", () => {
    const state = parsedIcsToEditorState({
      ...base,
      event: parsed({
        start: new Date("2026-10-05T07:00:00Z"),
        end: new Date("2026-10-05T08:00:00Z"),
        timeZone: "America/New_York",
      }),
    });
    expect(state.timeZone).toBe("America/New_York");
    expect(state.startTime).toBe("03:00");
  });

  it("maps an all-day span to inclusive start and end days", () => {
    const state = parsedIcsToEditorState({
      ...base,
      event: parsed({
        isAllDay: true,
        start: new Date("2026-10-05T00:00:00Z"),
        end: new Date("2026-10-08T00:00:00Z"),
      }),
    });
    expect(state.isAllDay).toBe(true);
    expect(state.startDate).toBe("2026-10-05");
    expect(state.endDate).toBe("2026-10-07");
    expect(getEditorProblem(state)).toBeNull();
  });

  it("carries reminders as overrides and none as defaults", () => {
    expect(
      parsedIcsToEditorState({
        ...base,
        event: parsed({ reminders: [10, 60] }),
      }).reminders,
    ).toEqual({
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 10 },
        { method: "popup", minutes: 60 },
      ],
    });
    expect(
      parsedIcsToEditorState({ ...base, event: parsed({}) }).reminders,
    ).toEqual({ useDefault: true, overrides: [] });
  });

  it("de-duplicates attendees case-insensitively", () => {
    const state = parsedIcsToEditorState({
      ...base,
      event: parsed({
        organizer: { email: "ME@example.com", name: null },
        attendees: [
          { email: "a@example.com", name: null, responseStatus: "accepted" },
          { email: "A@example.com", name: null, responseStatus: "accepted" },
          { email: "b@example.com", name: null, responseStatus: "accepted" },
        ],
      }),
    });
    expect(state.guests).toEqual(["a@example.com", "b@example.com"]);
  });
});
