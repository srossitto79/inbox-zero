import { describe, expect, it, vi } from "vitest";
import type { Client } from "@microsoft/microsoft-graph-client";
import {
  createMicrosoftEventSource,
  mapMicrosoftEvent,
  type MicrosoftGraphEvent,
} from "./microsoft-event-source";
import { SyncCursorExpiredError } from "./types";

vi.mock("server-only", () => ({}));

function upsertData(event: MicrosoftGraphEvent) {
  const item = mapMicrosoftEvent(event, "Europe/Rome");
  if (item?.kind !== "upsert") throw new Error("expected an upsert");
  return item.data;
}

describe("mapMicrosoftEvent", () => {
  it("reads UTC date-times without an offset as UTC", () => {
    const data = upsertData({
      id: "evt-1",
      subject: "Review",
      start: { dateTime: "2026-10-05T07:00:00.0000000" },
      end: { dateTime: "2026-10-05T08:00:00.0000000" },
      originalStartTimeZone: "Europe/Rome",
      onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/1" },
      webLink: "https://outlook.office.com/calendar/item/1",
      isOrganizer: true,
      responseStatus: { response: "organizer" },
      attendees: [
        {
          emailAddress: { address: "a@example.com", name: "A" },
          status: { response: "tentativelyAccepted" },
        },
      ],
    });

    expect(data).toMatchObject({
      title: "Review",
      startTime: new Date("2026-10-05T07:00:00Z"),
      endTime: new Date("2026-10-05T08:00:00Z"),
      timezone: "Europe/Rome",
      videoLink: "https://teams.microsoft.com/l/meetup-join/1",
      isOrganizer: true,
      selfResponseStatus: "accepted",
    });
    expect(data.attendees).toEqual([
      { email: "a@example.com", name: "A", responseStatus: "tentative" },
    ]);
  });

  it("keeps all-day events on their dates whatever the reported zone", () => {
    const data = upsertData({
      id: "holiday",
      isAllDay: true,
      start: { dateTime: "2026-12-25T00:00:00.0000000" },
      end: { dateTime: "2026-12-26T00:00:00.0000000" },
    });

    expect(data.isAllDay).toBe(true);
    expect(data.startTime).toEqual(new Date("2026-12-25T00:00:00Z"));
    expect(data.endTime).toEqual(new Date("2026-12-26T00:00:00Z"));
  });

  it("links an occurrence to its series and original slot", () => {
    const data = upsertData({
      id: "occ-2",
      type: "occurrence",
      seriesMasterId: "master",
      originalStart: "2026-10-12T07:00:00Z",
      start: { dateTime: "2026-10-12T07:00:00.0000000" },
      end: { dateTime: "2026-10-12T08:00:00.0000000" },
    });

    expect(data.recurringEventId).toBe("master");
    expect(data.originalStartTime).toEqual(new Date("2026-10-12T07:00:00Z"));
    expect(data.recurrence).toEqual([]);
  });

  it("drops a Windows time zone name it cannot use", () => {
    expect(
      upsertData({
        id: "evt-1",
        originalStartTimeZone: "W. Europe Standard Time",
        start: { dateTime: "2026-10-05T07:00:00.0000000" },
        end: { dateTime: "2026-10-05T08:00:00.0000000" },
      }).timezone,
    ).toBe("Europe/Rome");
  });

  it("removes deleted, moved-out and cancelled events", () => {
    for (const event of [
      { id: "a", "@removed": { reason: "deleted" } },
      { id: "a", "@removed": { reason: "changed" } },
      { id: "a", isCancelled: true },
    ] satisfies MicrosoftGraphEvent[]) {
      expect(mapMicrosoftEvent(event, null)).toEqual({
        kind: "remove",
        providerEventId: "a",
        withInstances: false,
      });
    }
  });

  it("skips series masters", () => {
    expect(
      mapMicrosoftEvent({ id: "m", type: "seriesMaster" }, null),
    ).toBeNull();
  });
});

describe("createMicrosoftEventSource", () => {
  function clientWith(get: ReturnType<typeof vi.fn>) {
    const request = {
      query: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      get,
    };
    const api = vi.fn().mockReturnValue(request);
    return { client: { api } as unknown as Client, api };
  }

  const request = {
    calendarId: "cal/1",
    cursor: null,
    pageToken: null,
    window: { from: new Date("2026-07-01Z"), to: new Date("2027-10-01Z") },
    calendarTimeZone: null,
  };

  it("starts a full sync on the calendar's delta endpoint", async () => {
    const get = vi.fn().mockResolvedValue({
      value: [],
      "@odata.deltaLink": "https://graph/delta?token=1",
    });
    const { client, api } = clientWith(get);

    const page = await createMicrosoftEventSource(client).fetchPage(request);

    expect(api).toHaveBeenCalledWith(
      "/me/calendars/cal%2F1/calendarView/delta",
    );
    expect(page).toEqual({
      items: [],
      nextPageToken: null,
      nextCursor: "https://graph/delta?token=1",
    });
  });

  it("follows the next link and withholds the delta link until the last page", async () => {
    const get = vi.fn().mockResolvedValue({
      value: [],
      "@odata.nextLink": "https://graph/delta?skiptoken=2",
    });
    const { client, api } = clientWith(get);

    const page = await createMicrosoftEventSource(client).fetchPage({
      ...request,
      pageToken: "https://graph/delta?skiptoken=1",
    });

    expect(api).toHaveBeenCalledWith("https://graph/delta?skiptoken=1");
    expect(page).toMatchObject({
      nextPageToken: "https://graph/delta?skiptoken=2",
      nextCursor: null,
    });
  });

  it("reports an expired delta link as a cursor expiry", async () => {
    const get = vi.fn().mockRejectedValue(
      Object.assign(new Error("Gone"), {
        statusCode: 410,
        code: "syncStateNotFound",
      }),
    );
    const { client } = clientWith(get);

    await expect(
      createMicrosoftEventSource(client).fetchPage({
        ...request,
        cursor: "https://graph/delta?token=old",
      }),
    ).rejects.toBeInstanceOf(SyncCursorExpiredError);
  });
});
