import { describe, expect, it, vi } from "vitest";
import type { calendar_v3 } from "@googleapis/calendar";
import { createGoogleEventSource, mapGoogleEvent } from "./google-event-source";
import { SyncCursorExpiredError } from "./types";

vi.mock("server-only", () => ({}));

function upsertData(
  event: calendar_v3.Schema$Event,
  zone: string | null = null,
) {
  const item = mapGoogleEvent(event, zone);
  if (item?.kind !== "upsert") throw new Error("expected an upsert");
  return item.data;
}

describe("mapGoogleEvent", () => {
  it("maps a timed event with attendees, video link and organizer", () => {
    const data = upsertData(
      {
        id: "evt-1",
        iCalUID: "evt-1@google.com",
        summary: "Planning",
        location: "Room 4",
        start: {
          dateTime: "2026-10-05T09:00:00+02:00",
          timeZone: "Europe/Rome",
        },
        end: { dateTime: "2026-10-05T10:00:00+02:00" },
        htmlLink: "https://calendar.google.com/event?eid=1",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
        organizer: {
          email: "boss@example.com",
          displayName: "Boss",
          self: false,
        },
        attendees: [
          { email: "me@example.com", self: true, responseStatus: "accepted" },
          { email: "boss@example.com", organizer: true },
        ],
      },
      "UTC",
    );

    expect(data).toMatchObject({
      providerEventId: "evt-1",
      iCalUid: "evt-1@google.com",
      title: "Planning",
      location: "Room 4",
      startTime: new Date("2026-10-05T07:00:00Z"),
      endTime: new Date("2026-10-05T08:00:00Z"),
      isAllDay: false,
      timezone: "Europe/Rome",
      status: "CONFIRMED",
      isBusy: true,
      selfResponseStatus: "accepted",
      videoLink: "https://meet.google.com/abc-defg-hij",
      organizerEmail: "boss@example.com",
    });
    expect(data.attendees).toEqual([
      { email: "me@example.com", responseStatus: "accepted", isSelf: true },
      { email: "boss@example.com", isOrganizer: true },
    ]);
  });

  it("stores a multi-day all-day event as floating UTC dates", () => {
    const data = upsertData({
      id: "trip",
      summary: "Trip",
      start: { date: "2026-10-30" },
      end: { date: "2026-11-02" },
    });

    expect(data.isAllDay).toBe(true);
    expect(data.startTime).toEqual(new Date("2026-10-30T00:00:00Z"));
    expect(data.endTime).toEqual(new Date("2026-11-02T00:00:00Z"));
  });

  it("keeps the master rule and falls back to the calendar zone", () => {
    const data = upsertData(
      {
        id: "series",
        summary: "Standup",
        start: { dateTime: "2026-03-23T09:00:00+01:00" },
        end: { dateTime: "2026-03-23T09:15:00+01:00" },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      },
      "Europe/Rome",
    );

    expect(data.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
    expect(data.timezone).toBe("Europe/Rome");
  });

  it("links an exception to its series and slot", () => {
    const data = upsertData({
      id: "series_20261006T070000Z",
      summary: "Standup (moved)",
      recurringEventId: "series",
      originalStartTime: { dateTime: "2026-10-06T09:00:00+02:00" },
      start: { dateTime: "2026-10-06T14:00:00+02:00" },
      end: { dateTime: "2026-10-06T14:15:00+02:00" },
    });

    expect(data.recurringEventId).toBe("series");
    expect(data.originalStartTime).toEqual(new Date("2026-10-06T07:00:00Z"));
  });

  it("turns a cancelled instance into a tombstone for its slot", () => {
    const item = mapGoogleEvent(
      {
        id: "series_20261007T070000Z",
        status: "cancelled",
        recurringEventId: "series",
        originalStartTime: { dateTime: "2026-10-07T09:00:00+02:00" },
      },
      null,
    );

    expect(item).toMatchObject({
      kind: "upsert",
      data: {
        status: "CANCELLED",
        recurringEventId: "series",
        originalStartTime: new Date("2026-10-07T07:00:00Z"),
      },
    });
  });

  it("removes a cancelled event, and its exceptions when it is a series", () => {
    expect(mapGoogleEvent({ id: "evt-1", status: "cancelled" }, null)).toEqual({
      kind: "remove",
      providerEventId: "evt-1",
      withInstances: true,
    });
  });

  it("marks transparent and tentative events", () => {
    const data = upsertData({
      id: "evt-1",
      status: "tentative",
      transparency: "transparent",
      start: { dateTime: "2026-10-05T09:00:00Z" },
      end: { dateTime: "2026-10-05T10:00:00Z" },
    });

    expect(data).toMatchObject({ status: "TENTATIVE", isBusy: false });
  });

  it("ignores an unknown time zone", () => {
    expect(
      upsertData({
        id: "evt-1",
        start: { dateTime: "2026-10-05T09:00:00Z", timeZone: "Mars/Olympus" },
        end: { dateTime: "2026-10-05T10:00:00Z" },
      }).timezone,
    ).toBeNull();
  });
});

describe("createGoogleEventSource", () => {
  function clientFailing(status: number) {
    return {
      events: {
        list: vi.fn().mockRejectedValue(
          Object.assign(new Error("Gone"), {
            code: status,
            response: { status },
          }),
        ),
      },
    } as unknown as calendar_v3.Calendar;
  }

  const request = {
    calendarId: "primary",
    cursor: "token",
    pageToken: null,
    window: { from: new Date("2026-07-01Z"), to: new Date("2027-10-01Z") },
    calendarTimeZone: null,
  };

  it("reports an expired sync token as a cursor expiry", async () => {
    await expect(
      createGoogleEventSource(clientFailing(410)).fetchPage(request),
    ).rejects.toBeInstanceOf(SyncCursorExpiredError);
  });

  it("rethrows other provider errors", async () => {
    await expect(
      createGoogleEventSource(clientFailing(500)).fetchPage(request),
    ).rejects.not.toBeInstanceOf(SyncCursorExpiredError);
  });

  it("sends the sync token without a time window, and the window without one", async () => {
    const list = vi
      .fn()
      .mockResolvedValue({ data: { items: [], nextSyncToken: "n" } });
    const source = createGoogleEventSource({
      events: { list },
    } as unknown as calendar_v3.Calendar);

    await source.fetchPage(request);
    await source.fetchPage({ ...request, cursor: null });

    expect(list.mock.calls[0][0]).toMatchObject({
      syncToken: "token",
      singleEvents: false,
      showDeleted: true,
    });
    expect(list.mock.calls[0][0]).not.toHaveProperty("timeMin");
    expect(list.mock.calls[1][0]).toMatchObject({
      timeMin: "2026-07-01T00:00:00.000Z",
      timeMax: "2027-10-01T00:00:00.000Z",
    });
    expect(list.mock.calls[1][0]).not.toHaveProperty("syncToken");
  });

  it("returns the sync token only on the last page", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: { items: [], nextPageToken: "p2" } })
      .mockResolvedValueOnce({ data: { items: [], nextSyncToken: "final" } });
    const source = createGoogleEventSource({
      events: { list },
    } as unknown as calendar_v3.Calendar);

    expect(await source.fetchPage(request)).toMatchObject({
      nextPageToken: "p2",
      nextCursor: null,
    });
    expect(await source.fetchPage(request)).toMatchObject({
      nextPageToken: null,
      nextCursor: "final",
    });
  });
});
