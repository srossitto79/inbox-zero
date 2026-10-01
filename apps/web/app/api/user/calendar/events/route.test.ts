import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createScopedLogger } from "@/utils/logger";

vi.mock("@/utils/prisma");
vi.mock("@/utils/middleware", () => ({
  withEmailAccount:
    (
      _name: string,
      handler: (
        request: NextRequest & {
          auth: { emailAccountId: string; userId: string };
          logger: ReturnType<typeof createScopedLogger>;
        },
        context: { params: Promise<Record<string, string>> },
      ) => Promise<Response>,
    ) =>
    (
      request: NextRequest,
      context: { params: Promise<Record<string, string>> },
    ) =>
      handler(
        Object.assign(request, {
          auth: { emailAccountId: "account-1", userId: "user-1" },
          logger: createScopedLogger("test"),
        }),
        context,
      ),
}));

import { GET } from "./route";

function request(query: string) {
  return new NextRequest(`http://localhost/api/user/calendar/events?${query}`);
}

function callGet(queryString: string) {
  return GET(request(queryString), { params: Promise.resolve({}) });
}

const query =
  "from=2026-10-01T00%3A00%3A00.000Z&to=2026-11-01T00%3A00%3A00.000Z&timezone=Europe%2FRome";

beforeEach(() => {
  vi.clearAllMocks();
  prisma.calendar.findMany.mockResolvedValue([
    {
      id: "cal-1",
      name: "Work",
      color: "#4285f4",
    },
  ] as never);
  prisma.calendarEvent.findMany.mockResolvedValue([]);
});

describe("GET /api/user/calendar/events", () => {
  it("returns stored events for enabled calendars of the authenticated account", async () => {
    prisma.calendarEvent.findMany.mockResolvedValue([
      {
        id: "row-1",
        calendarId: "cal-1",
        providerEventId: "evt-1",
        title: "Planning",
        description: null,
        location: "Room 4",
        startTime: new Date("2026-10-05T07:00:00Z"),
        endTime: new Date("2026-10-05T08:00:00Z"),
        isAllDay: false,
        timezone: "Europe/Rome",
        status: "CONFIRMED",
        isBusy: true,
        organizerEmail: "boss@example.com",
        organizerName: "Boss",
        isOrganizer: false,
        selfResponseStatus: "accepted",
        attendees: [{ email: "me@example.com", isSelf: true }],
        recurringEventId: null,
        recurrence: [],
        originalStartTime: null,
        videoLink: "https://meet.google.com/abc-defg-hij",
        htmlLink: "https://calendar.google.com/event?eid=1",
      },
    ] as never);

    const response = await callGet(query);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.calendar.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isEnabled: true,
          connection: { emailAccountId: "account-1", isConnected: true },
        },
      }),
    );
    expect(prisma.calendarEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ calendarId: { in: ["cal-1"] } }),
      }),
    );
    expect(body.events).toEqual([
      expect.objectContaining({
        id: "row-1",
        title: "Planning",
        calendarName: "Work",
        calendarColor: "#4285f4",
        start: "2026-10-05T07:00:00.000Z",
      }),
    ]);
  });

  it("does not query events when there are no enabled calendars", async () => {
    prisma.calendar.findMany.mockResolvedValue([]);

    const response = await callGet(query);

    expect(await response.json()).toEqual({
      events: [],
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-11-01T00:00:00.000Z",
    });
    expect(prisma.calendarEvent.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ["missing end", "from=2026-10-01T00%3A00%3A00Z&timezone=UTC"],
    [
      "backwards range",
      "from=2026-11-01T00%3A00%3A00Z&to=2026-10-01T00%3A00%3A00Z&timezone=UTC",
    ],
    [
      "range over 62 days",
      "from=2026-01-01T00%3A00%3A00Z&to=2026-12-01T00%3A00%3A00Z&timezone=UTC",
    ],
    [
      "invalid time zone",
      "from=2026-10-01T00%3A00%3A00Z&to=2026-11-01T00%3A00%3A00Z&timezone=Mars%2FOlympus",
    ],
  ])("rejects %s", async (_name, invalidQuery) => {
    const response = await callGet(invalidQuery);

    expect(response.status).toBe(400);
    expect(prisma.calendar.findMany).not.toHaveBeenCalled();
  });
});
