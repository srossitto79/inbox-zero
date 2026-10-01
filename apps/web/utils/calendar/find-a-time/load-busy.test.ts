import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createScopedLogger } from "@/utils/logger";
import { CALENDAR_SCOPES } from "@/utils/gmail/scopes";
import { CalendarSyncPausedError } from "@/utils/calendar/calendar-sync-budget";
import {
  loadGuestAvailability,
  loadOwnBusy,
} from "@/utils/calendar/find-a-time/load-busy";

const { freebusyQuery, budget } = vi.hoisted(() => ({
  freebusyQuery: vi.fn(),
  budget: vi.fn(),
}));

vi.mock("@/utils/prisma");
vi.mock("@/utils/calendar/client", () => ({
  getCalendarClientWithRefresh: vi.fn(async () => ({
    freebusy: { query: freebusyQuery },
  })),
}));
vi.mock("@/utils/calendar/calendar-sync-budget", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/utils/calendar/calendar-sync-budget")
    >();
  return { ...actual, withCalendarSyncBudget: budget };
});

const logger = createScopedLogger("test");
const from = new Date("2026-10-05T00:00:00Z");
const to = new Date("2026-10-06T00:00:00Z");

const connection = {
  id: "conn-1",
  provider: "google",
  isConnected: true,
  scope: CALENDAR_SCOPES.join(" "),
  accessToken: "token",
  refreshToken: "refresh",
  expiresAt: new Date(Date.now() + 3_600_000),
};

describe("loadGuestAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    budget.mockImplementation(async (_input, operation) => operation());
    prisma.calendarConnection.findMany.mockResolvedValue([connection] as never);
  });

  it("reports guests with errors or no answer as unknown, never free", async () => {
    freebusyQuery.mockResolvedValue({
      data: {
        calendars: {
          "known@example.com": {
            busy: [
              {
                start: "2026-10-05T09:00:00Z",
                end: "2026-10-05T10:00:00Z",
              },
            ],
          },
          "private@example.com": { errors: [{ reason: "notFound" }] },
        },
      },
    });

    const result = await loadGuestAvailability({
      emailAccountId: "account-1",
      emails: [
        "known@example.com",
        "private@example.com",
        "missing@example.com",
      ],
      from,
      to,
      logger,
    });

    expect(result["known@example.com"]).toEqual({
      status: "known",
      busy: [
        {
          start: new Date("2026-10-05T09:00:00Z"),
          end: new Date("2026-10-05T10:00:00Z"),
        },
      ],
    });
    expect(result["private@example.com"]).toEqual({ status: "unknown" });
    expect(result["missing@example.com"]).toEqual({ status: "unknown" });
  });

  it("reports everybody as unknown when the connection lacks scopes", async () => {
    prisma.calendarConnection.findMany.mockResolvedValue([
      { ...connection, scope: null },
    ] as never);
    const result = await loadGuestAvailability({
      emailAccountId: "account-1",
      emails: ["a@example.com"],
      from,
      to,
      logger,
    });
    expect(result["a@example.com"]).toEqual({ status: "unknown" });
    expect(freebusyQuery).not.toHaveBeenCalled();
  });

  it("goes through the provider budget and degrades to unknown when paused", async () => {
    budget.mockRejectedValue(new CalendarSyncPausedError(5000));
    const result = await loadGuestAvailability({
      emailAccountId: "account-1",
      emails: ["a@example.com"],
      from,
      to,
      logger,
    });
    expect(budget).toHaveBeenCalledWith(
      { emailAccountId: "account-1", provider: "google" },
      expect.any(Function),
    );
    expect(result["a@example.com"]).toEqual({ status: "unknown" });
  });

  it("does not call the provider without guests", async () => {
    expect(
      await loadGuestAvailability({
        emailAccountId: "account-1",
        emails: [],
        from,
        to,
        logger,
      }),
    ).toEqual({});
    expect(budget).not.toHaveBeenCalled();
  });
});

describe("loadOwnBusy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const event = (overrides: Record<string, unknown>) => ({
    id: "event-1",
    calendarId: "cal-1",
    providerEventId: "p1",
    title: "Meeting",
    description: null,
    location: null,
    startTime: new Date("2026-10-05T09:00:00Z"),
    endTime: new Date("2026-10-05T10:00:00Z"),
    isAllDay: false,
    timezone: null,
    status: "CONFIRMED",
    isBusy: true,
    organizerEmail: null,
    organizerName: null,
    isOrganizer: false,
    selfResponseStatus: null,
    attendees: null,
    recurringEventId: null,
    recurrence: [],
    originalStartTime: null,
    videoLink: null,
    htmlLink: null,
    ...overrides,
  });

  it("keeps busy events and drops free, declined and cancelled ones", async () => {
    prisma.calendar.findMany.mockResolvedValue([
      { id: "cal-1", name: "Main", color: null },
    ] as never);
    prisma.calendarEvent.findMany.mockResolvedValue([
      event({ id: "busy" }),
      event({ id: "free", isBusy: false }),
      event({ id: "declined", selfResponseStatus: "declined" }),
      event({ id: "cancelled", status: "CANCELLED" }),
      event({
        id: "allday",
        isAllDay: true,
        startTime: new Date("2026-10-05T00:00:00Z"),
        endTime: new Date("2026-10-06T00:00:00Z"),
      }),
    ] as never);

    const busy = await loadOwnBusy({
      emailAccountId: "account-1",
      from,
      to,
      timeZone: "UTC",
    });

    expect(busy).toHaveLength(2);
    expect(busy).toContainEqual({
      allDay: true,
      startDate: "2026-10-05",
      endDate: "2026-10-06",
    });
    expect(busy).toContainEqual({
      start: new Date("2026-10-05T09:00:00Z"),
      end: new Date("2026-10-05T10:00:00Z"),
    });
  });

  it("only reads calendars of the account", async () => {
    prisma.calendar.findMany.mockResolvedValue([]);
    await loadOwnBusy({
      emailAccountId: "account-1",
      from,
      to,
      timeZone: "UTC",
    });
    expect(prisma.calendar.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          connection: { emailAccountId: "account-1", isConnected: true },
        }),
      }),
    );
    expect(prisma.calendarEvent.findMany).not.toHaveBeenCalled();
  });
});
