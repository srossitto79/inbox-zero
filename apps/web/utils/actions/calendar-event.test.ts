import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import {
  createCalendarEventAction,
  deleteCalendarEventAction,
  moveCalendarEventAction,
  respondToCalendarEventAction,
  updateCalendarEventAction,
} from "@/utils/actions/calendar-event";
import { CALENDAR_SCOPES } from "@/utils/gmail/scopes";
import {
  createEventLocalFirst,
  deleteEventLocalFirst,
  moveEventLocalFirst,
  updateEventLocalFirst,
} from "@/utils/calendar/write/local-first";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
vi.mock("@/utils/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "user-1", email: "user@example.com" },
  })),
}));
vi.mock("@/utils/calendar/write/get-event-writer", () => ({
  getCalendarEventWriter: vi.fn(() => ({ writer: true })),
}));
vi.mock("@/utils/calendar/write/local-first");

const timing = {
  isAllDay: false as const,
  start: "2026-10-05T09:00:00+02:00",
  end: "2026-10-05T10:00:00+02:00",
  timeZone: "Europe/Rome",
};

function calendarRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cal-1",
    calendarId: "primary",
    name: "Work",
    color: "#4285f4",
    timezone: "Europe/Rome",
    canEdit: true,
    connection: {
      id: "conn-1",
      email: "me@example.com",
      provider: "google",
      isConnected: true,
      scope: CALENDAR_SCOPES.join(" "),
      accessToken: "token",
      refreshToken: "refresh",
      expiresAt: null,
    },
    ...overrides,
  };
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    calendarId: "cal-1",
    providerEventId: "evt1",
    title: "Planning",
    startTime: new Date("2026-10-05T07:00:00Z"),
    endTime: new Date("2026-10-05T08:00:00Z"),
    isAllDay: false,
    recurrence: [],
    attendees: [
      { email: "me@example.com", isSelf: true, responseStatus: "accepted" },
      { email: "a@example.com", responseStatus: "declined" },
    ],
    ...overrides,
  };
}

const savedEvent = {
  id: "row-1",
  calendarId: "cal-1",
  providerEventId: "evt1",
  title: "Planning",
  description: null,
  location: null,
  startTime: new Date("2026-10-05T07:00:00Z"),
  endTime: new Date("2026-10-05T08:00:00Z"),
  isAllDay: false,
  timezone: "Europe/Rome",
  status: "CONFIRMED",
  isBusy: true,
  organizerEmail: null,
  organizerName: null,
  isOrganizer: true,
  selfResponseStatus: null,
  attendees: null,
  recurringEventId: null,
  recurrence: [],
  originalStartTime: null,
  videoLink: null,
  htmlLink: null,
  reminders: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.emailAccount.findUnique.mockResolvedValue({
    email: "user@example.com",
    account: { userId: "user-1", provider: "google" },
  } as never);
  prisma.calendar.findFirst.mockResolvedValue(calendarRow() as never);
  prisma.calendarEvent.findUnique.mockResolvedValue(eventRow() as never);
  vi.mocked(createEventLocalFirst).mockResolvedValue({
    ok: true,
    event: savedEvent as never,
  });
  vi.mocked(updateEventLocalFirst).mockResolvedValue({
    ok: true,
    event: savedEvent as never,
  });
  vi.mocked(moveEventLocalFirst).mockResolvedValue({
    ok: true,
    event: savedEvent as never,
  });
  vi.mocked(deleteEventLocalFirst).mockResolvedValue({ ok: true });
});

describe("authorization", () => {
  it("only looks calendars up through the caller's connections", async () => {
    await createCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      title: "x",
      timing,
    });

    expect(prisma.calendar.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "cal-1",
          connection: { emailAccountId: "email-account-id" },
        },
      }),
    );
  });

  it("rejects a calendar that belongs to someone else", async () => {
    prisma.calendar.findFirst.mockResolvedValue(null);

    const result = await createCalendarEventAction("email-account-id", {
      calendarId: "foreign",
      title: "x",
      timing,
    });

    expect(result?.serverError).toBe("Calendar not found");
    expect(createEventLocalFirst).not.toHaveBeenCalled();
  });

  it("rejects an account the user does not own", async () => {
    prisma.emailAccount.findUnique.mockResolvedValue({
      email: "other@example.com",
      account: { userId: "someone-else", provider: "google" },
    } as never);

    const result = await deleteCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      providerEventId: "evt1",
    });

    expect(result?.serverError).toBe("Unauthorized");
    expect(deleteEventLocalFirst).not.toHaveBeenCalled();
  });

  it("asks to reconnect instead of writing when scopes are missing", async () => {
    prisma.calendar.findFirst.mockResolvedValue(
      calendarRow({
        connection: { ...calendarRow().connection, scope: null },
      }) as never,
    );

    const result = await updateCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      providerEventId: "evt1",
      title: "x",
    });

    expect(result?.serverError).toBe(
      "Reconnect Google Calendar to edit events",
    );
    expect(updateEventLocalFirst).not.toHaveBeenCalled();
  });

  it("refuses Outlook and read-only calendars", async () => {
    prisma.calendar.findFirst.mockResolvedValueOnce(
      calendarRow({
        connection: { ...calendarRow().connection, provider: "microsoft" },
      }) as never,
    );
    const outlook = await createCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      title: "x",
      timing,
    });
    expect(outlook?.serverError).toBe("Outlook events are read-only");

    prisma.calendar.findFirst.mockResolvedValueOnce(
      calendarRow({ canEdit: false }) as never,
    );
    const readOnly = await createCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      title: "x",
      timing,
    });
    expect(readOnly?.serverError).toBe("This calendar is read-only");
    expect(createEventLocalFirst).not.toHaveBeenCalled();
  });

  it("answers not found for an event the calendar does not have", async () => {
    prisma.calendarEvent.findUnique.mockResolvedValue(null);

    const result = await respondToCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      providerEventId: "missing",
      response: "accepted",
    });

    expect(result?.serverError).toBe("Event not found");
  });
});

describe("validation", () => {
  it("rejects an end before the start", async () => {
    const result = await createCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      title: "x",
      timing: { ...timing, end: timing.start },
    });

    expect(result?.validationErrors).toBeDefined();
    expect(createEventLocalFirst).not.toHaveBeenCalled();
  });

  it("rejects an unknown time zone, a bad guest and too many reminders", async () => {
    const base = { calendarId: "cal-1", title: "x", timing };
    expect(
      (
        await createCalendarEventAction("email-account-id", {
          ...base,
          timing: { ...timing, timeZone: "Mars/Base" },
        })
      )?.validationErrors,
    ).toBeDefined();
    expect(
      (
        await createCalendarEventAction("email-account-id", {
          ...base,
          guests: [{ email: "not-an-email" }],
        })
      )?.validationErrors,
    ).toBeDefined();
    expect(
      (
        await createCalendarEventAction("email-account-id", {
          ...base,
          reminders: {
            useDefault: false,
            overrides: Array.from({ length: 6 }, () => ({
              method: "popup" as const,
              minutes: 10,
            })),
          },
        })
      )?.validationErrors,
    ).toBeDefined();
  });
});

describe("createCalendarEventAction", () => {
  it("invites guests by default and returns the saved event", async () => {
    const result = await createCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      title: "Planning",
      timing,
      guests: [{ email: "a@example.com" }, { email: "A@example.com" }],
      addVideoConference: true,
    });

    expect(createEventLocalFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        organizerEmail: "me@example.com",
        providerEventId: expect.stringMatching(/^[0-9a-f]{32}$/),
        input: expect.objectContaining({
          sendUpdates: "all",
          addVideoConference: true,
          guests: [{ email: "a@example.com" }],
          timing: {
            isAllDay: false,
            start: new Date("2026-10-05T07:00:00Z"),
            end: new Date("2026-10-05T08:00:00Z"),
            timeZone: "Europe/Rome",
          },
        }),
      }),
    );
    expect(result?.data).toMatchObject({
      status: "saved",
      event: { providerEventId: "evt1", calendarName: "Work" },
    });
  });

  it("sends nothing without guests, and honours an explicit choice", async () => {
    await createCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      title: "Solo",
      timing,
    });
    await createCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      title: "Quiet",
      timing,
      guests: [{ email: "a@example.com" }],
      sendUpdates: "none",
    });

    const sent = vi
      .mocked(createEventLocalFirst)
      .mock.calls.map(([call]) => call.input.sendUpdates);
    expect(sent).toEqual(["none", "none"]);
  });
});

describe("updateCalendarEventAction", () => {
  it("keeps the viewer on the event and the answers of kept guests", async () => {
    await updateCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      providerEventId: "evt1",
      guests: [{ email: "a@example.com" }, { email: "new@example.com" }],
    });

    const call = vi.mocked(updateEventLocalFirst).mock.calls[0][0];
    expect(call.patch.guests).toEqual([
      { email: "me@example.com", name: undefined, responseStatus: "accepted" },
      { email: "a@example.com", name: undefined, responseStatus: "declined" },
      { email: "new@example.com", name: undefined },
    ]);
    expect(call.sendUpdates).toBe("all");
  });

  it("reports a conflict with the fresh event instead of failing", async () => {
    vi.mocked(updateEventLocalFirst).mockResolvedValue({
      ok: false,
      failure: { ok: false, reason: "conflict", message: "Event changed" },
      event: savedEvent as never,
    });

    const result = await updateCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      providerEventId: "evt1",
      title: "x",
    });

    expect(result?.serverError).toBeUndefined();
    expect(result?.data).toMatchObject({
      status: "conflict",
      event: { providerEventId: "evt1" },
    });
  });

  it("surfaces other failures to the caller", async () => {
    vi.mocked(updateEventLocalFirst).mockResolvedValue({
      ok: false,
      failure: {
        ok: false,
        reason: "paused",
        message: "Calendar is busy. Try again shortly.",
        retryAfterMs: 30_000,
      },
    });

    const result = await updateCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      providerEventId: "evt1",
      title: "x",
    });

    expect(result?.serverError).toBe("Calendar is busy. Try again shortly.");
  });
});

describe("moveCalendarEventAction", () => {
  it("moves timed events to an instant and all-day events to a date", async () => {
    await moveCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      providerEventId: "evt1",
      newStart: "2026-10-06T09:30:00Z",
    });
    expect(vi.mocked(moveEventLocalFirst).mock.calls[0][0].newStart).toEqual(
      new Date("2026-10-06T09:30:00Z"),
    );

    prisma.calendarEvent.findUnique.mockResolvedValue(
      eventRow({ isAllDay: true, attendees: null }) as never,
    );
    await moveCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      providerEventId: "evt1",
      newStart: "2026-10-30",
    });
    const second = vi.mocked(moveEventLocalFirst).mock.calls[1][0];
    expect(second.newStart).toBe("2026-10-30");
    expect(second.sendUpdates).toBe("none");
  });

  it("rejects a date for a timed event", async () => {
    const result = await moveCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      providerEventId: "evt1",
      newStart: "2026-10-30",
    });

    expect(result?.serverError).toBe("Invalid date");
    expect(moveEventLocalFirst).not.toHaveBeenCalled();
  });
});

describe("deleteCalendarEventAction", () => {
  it("notifies guests unless told otherwise", async () => {
    const result = await deleteCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      providerEventId: "evt1",
    });

    expect(deleteEventLocalFirst).toHaveBeenCalledWith(
      expect.objectContaining({ sendUpdates: "all" }),
    );
    expect(result?.data).toEqual({ status: "deleted" });
  });

  it("reports a provider refusal", async () => {
    vi.mocked(deleteEventLocalFirst).mockResolvedValue({
      ok: false,
      failure: {
        ok: false,
        reason: "forbidden",
        message: "You cannot edit this event",
      },
    });

    const result = await deleteCalendarEventAction("email-account-id", {
      calendarId: "cal-1",
      providerEventId: "evt1",
    });

    expect(result?.serverError).toBe("You cannot edit this event");
  });
});
