import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestLogger } from "@/__tests__/helpers";
import { redis } from "@/utils/redis";
import { isEmailProviderRateLimitRedisConfigured } from "@/utils/redis/email-provider-rate-limit";
import {
  createGoogleEventWriter,
  newGoogleEventId,
} from "@/utils/calendar/write/google-writer";
import type { EventTiming } from "@/utils/calendar/write/types";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/redis", () => ({ redis: { eval: vi.fn(), set: vi.fn() } }));
vi.mock("@/utils/redis/email-provider-rate-limit");

const events = {
  insert: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
};

const timed: EventTiming = {
  isAllDay: false,
  start: new Date("2026-10-05T07:00:00.000Z"),
  end: new Date("2026-10-05T08:00:00.000Z"),
  timeZone: "Europe/Rome",
};

const providerEvent = {
  id: "evt1",
  etag: '"etag-2"',
  iCalUID: "evt1@google.com",
  summary: "Planning",
  start: { dateTime: "2026-10-05T09:00:00+02:00", timeZone: "Europe/Rome" },
  end: { dateTime: "2026-10-05T10:00:00+02:00", timeZone: "Europe/Rome" },
  htmlLink: "https://calendar.google.com/event?eid=evt1",
  updated: "2026-10-05T06:00:00.000Z",
};

function writer() {
  return createGoogleEventWriter({
    getClient: async () => ({ events }) as never,
    emailAccountId: "account-1",
    logger: createTestLogger(),
  });
}

function httpError(status: number, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), {
    code: status,
    response: { status, headers: {} },
    ...extra,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isEmailProviderRateLimitRedisConfigured).mockReturnValue(true);
  vi.mocked(redis.eval).mockResolvedValue(0);
  vi.mocked(redis.set).mockResolvedValue("OK");
});

describe("createEvent", () => {
  it("inserts with the chosen id and returns the stored shape", async () => {
    events.insert.mockResolvedValue({ data: providerEvent });

    const result = await writer().createEvent({
      providerCalendarId: "primary",
      providerEventId: "abc123",
      title: "Planning",
      location: "Room 1",
      timing: timed,
      guests: [{ email: "guest@example.com", name: "Guest" }],
      sendUpdates: "all",
    });

    expect(events.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        sendUpdates: "all",
        conferenceDataVersion: undefined,
        requestBody: expect.objectContaining({
          id: "abc123",
          summary: "Planning",
          location: "Room 1",
          start: {
            dateTime: "2026-10-05T07:00:00.000Z",
            timeZone: "Europe/Rome",
          },
          attendees: [
            {
              email: "guest@example.com",
              displayName: "Guest",
              responseStatus: undefined,
            },
          ],
        }),
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        providerEventId: "evt1",
        etag: '"etag-2"',
        iCalUid: "evt1@google.com",
        htmlLink: "https://calendar.google.com/event?eid=evt1",
      },
    });
  });

  it("sends all-day events as dates", async () => {
    events.insert.mockResolvedValue({ data: providerEvent });

    await writer().createEvent({
      providerCalendarId: "primary",
      providerEventId: "abc123",
      title: "Holiday",
      timing: {
        isAllDay: true,
        startDate: "2026-10-26",
        endDate: "2026-10-27",
      },
      guests: [],
      sendUpdates: "none",
    });

    const body = events.insert.mock.calls[0][0].requestBody;
    expect(body.start).toEqual({ date: "2026-10-26" });
    expect(body.end).toEqual({ date: "2026-10-27" });
    expect(body.attendees).toBeUndefined();
  });

  it("asks Google to create a Meet link", async () => {
    events.insert.mockResolvedValue({
      data: {
        ...providerEvent,
        hangoutLink: "https://meet.google.com/aaa-bbbb-ccc",
      },
    });

    const result = await writer().createEvent({
      providerCalendarId: "primary",
      providerEventId: "abc123",
      title: "Call",
      timing: timed,
      guests: [],
      addVideoConference: true,
      sendUpdates: "none",
    });

    const params = events.insert.mock.calls[0][0];
    expect(params.conferenceDataVersion).toBe(1);
    expect(params.requestBody.conferenceData.createRequest).toMatchObject({
      conferenceSolutionKey: { type: "hangoutsMeet" },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { videoLink: "https://meet.google.com/aaa-bbbb-ccc" },
    });
  });

  it("refuses an end before the start without calling Google", async () => {
    const result = await writer().createEvent({
      providerCalendarId: "primary",
      providerEventId: "abc123",
      title: "Backwards",
      timing: { ...timed, end: timed.start },
      guests: [],
      sendUpdates: "none",
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(events.insert).not.toHaveBeenCalled();
  });

  it("generates ids Google accepts", () => {
    expect(newGoogleEventId()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("updateEvent", () => {
  it("patches with If-Match and clears emptied fields", async () => {
    events.patch.mockResolvedValue({ data: providerEvent });

    const result = await writer().updateEvent({
      providerCalendarId: "primary",
      providerEventId: "evt1",
      etag: '"etag-1"',
      patch: { title: "Renamed", description: "", timing: timed },
      sendUpdates: "none",
    });

    const [params, options] = events.patch.mock.calls[0];
    expect(options).toEqual({ headers: { "If-Match": '"etag-1"' } });
    expect(params).toMatchObject({
      calendarId: "primary",
      eventId: "evt1",
      sendUpdates: "none",
      requestBody: {
        summary: "Renamed",
        description: null,
        location: undefined,
        start: { dateTime: "2026-10-05T07:00:00.000Z", date: null },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("turns a timed event into an all-day one by nulling the instants", async () => {
    events.patch.mockResolvedValue({ data: providerEvent });

    await writer().updateEvent({
      providerCalendarId: "primary",
      providerEventId: "evt1",
      etag: null,
      patch: {
        timing: {
          isAllDay: true,
          startDate: "2026-10-05",
          endDate: "2026-10-06",
        },
      },
      sendUpdates: "none",
    });

    const [params, options] = events.patch.mock.calls[0];
    expect(options).toBeUndefined();
    expect(params.requestBody.start).toEqual({
      date: "2026-10-05",
      dateTime: null,
      timeZone: null,
    });
  });

  it("reports an etag mismatch as a conflict", async () => {
    events.patch.mockRejectedValue(httpError(412));

    const result = await writer().updateEvent({
      providerCalendarId: "primary",
      providerEventId: "evt1",
      etag: '"stale"',
      patch: { title: "x" },
      sendUpdates: "none",
    });

    expect(result).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("maps missing permissions to a reconnect and read-only calendars to forbidden", async () => {
    events.patch.mockRejectedValueOnce(
      httpError(403, {
        response: {
          status: 403,
          headers: {},
          data: { error: { errors: [{ reason: "insufficientPermissions" }] } },
        },
      }),
    );
    const input = {
      providerCalendarId: "primary",
      providerEventId: "evt1",
      etag: null,
      patch: { title: "x" },
      sendUpdates: "none" as const,
    };
    expect(await writer().updateEvent(input)).toMatchObject({
      reason: "needs_reconnect",
    });

    events.patch.mockRejectedValueOnce(httpError(403));
    expect(await writer().updateEvent(input)).toMatchObject({
      reason: "forbidden",
    });
  });
});

describe("moveEvent", () => {
  it("keeps the duration of a timed event", async () => {
    events.patch.mockResolvedValue({ data: providerEvent });

    await writer().moveEvent({
      providerCalendarId: "primary",
      providerEventId: "evt1",
      etag: '"etag-1"',
      current: timed,
      newStart: new Date("2026-10-06T09:30:00.000Z"),
      sendUpdates: "all",
    });

    const [params] = events.patch.mock.calls[0];
    expect(params.sendUpdates).toBe("all");
    expect(params.requestBody.start.dateTime).toBe("2026-10-06T09:30:00.000Z");
    expect(params.requestBody.end.dateTime).toBe("2026-10-06T10:30:00.000Z");
    expect(params.requestBody.summary).toBeUndefined();
  });
});

describe("deleteEvent", () => {
  it("deletes and passes sendUpdates", async () => {
    events.delete.mockResolvedValue({});

    const result = await writer().deleteEvent({
      providerCalendarId: "primary",
      providerEventId: "evt1",
      sendUpdates: "all",
    });

    expect(events.delete).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "evt1",
      sendUpdates: "all",
    });
    expect(result).toEqual({ ok: true, value: null });
  });

  it("counts an event that is already gone as deleted", async () => {
    events.delete.mockRejectedValue(httpError(410));

    const result = await writer().deleteEvent({
      providerCalendarId: "primary",
      providerEventId: "evt1",
      sendUpdates: "none",
    });

    expect(result.ok).toBe(true);
  });
});

describe("respondToEvent", () => {
  it("patches only the viewer's attendee entry, without If-Match", async () => {
    events.patch.mockResolvedValue({ data: providerEvent });

    await writer().respondToEvent({
      providerCalendarId: "primary",
      providerEventId: "evt1",
      selfEmail: "me@example.com",
      response: "tentative",
      sendUpdates: "all",
    });

    const [params, options] = events.patch.mock.calls[0];
    expect(options).toBeUndefined();
    expect(params).toMatchObject({
      sendUpdates: "all",
      requestBody: {
        attendeesOmitted: true,
        attendees: [{ email: "me@example.com", responseStatus: "tentative" }],
      },
    });
  });
});

describe("setReminders", () => {
  it("sends overrides or the calendar defaults", async () => {
    events.patch.mockResolvedValue({ data: providerEvent });
    const base = {
      providerCalendarId: "primary",
      providerEventId: "evt1",
      etag: '"etag-1"',
    };

    await writer().setReminders({
      ...base,
      reminders: {
        useDefault: false,
        overrides: [{ method: "popup", minutes: 10 }],
      },
    });
    await writer().setReminders({ ...base, reminders: { useDefault: true } });

    expect(events.patch.mock.calls[0][0].requestBody.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 10 }],
    });
    expect(events.patch.mock.calls[0][0].sendUpdates).toBe("none");
    expect(events.patch.mock.calls[1][0].requestBody.reminders).toEqual({
      useDefault: true,
    });
  });
});

describe("rate limits", () => {
  it("pauses with a retry delay and starts a cooldown instead of retrying", async () => {
    events.insert.mockRejectedValue(
      Object.assign(new Error("Rate Limit Exceeded"), {
        code: 429,
        response: { status: 429, headers: { "retry-after": "90" } },
      }),
    );

    const result = await writer().createEvent({
      providerCalendarId: "primary",
      providerEventId: "abc123",
      title: "x",
      timing: timed,
      guests: [],
      sendUpdates: "none",
    });

    expect(result).toMatchObject({ ok: false, reason: "paused" });
    expect(events.insert).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalled();
  });

  it("does not call Google while the budget refuses", async () => {
    vi.mocked(redis.eval).mockResolvedValue(30_000);

    const result = await writer().deleteEvent({
      providerCalendarId: "primary",
      providerEventId: "evt1",
      sendUpdates: "none",
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "paused",
      retryAfterMs: 30_000,
    });
    expect(events.delete).not.toHaveBeenCalled();
  });
});
