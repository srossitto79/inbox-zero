import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createScopedLogger } from "@/utils/logger";
import { CALENDAR_SCOPES } from "@/utils/gmail/scopes";
import { CalendarSyncPausedError } from "@/utils/calendar/calendar-sync-budget";
import {
  createCalendar,
  deleteCalendar,
  setCalendarColor,
  setCalendarsVisibility,
  updateCalendar,
} from "@/utils/calendar/manage/manage-calendar";

const { client, budget } = vi.hoisted(() => ({
  client: {
    calendars: { insert: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    calendarList: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  },
  budget: vi.fn(),
}));

vi.mock("@/utils/prisma");
vi.mock("@/utils/calendar/client", () => ({
  getCalendarClientWithRefresh: vi.fn(async () => client),
}));
vi.mock("@/utils/calendar/calendar-sync-budget", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/utils/calendar/calendar-sync-budget")
    >();
  return { ...actual, withCalendarSyncBudget: budget };
});

const logger = createScopedLogger("test");
const emailAccountId = "account-1";

const connection = {
  id: "conn-1",
  provider: "google",
  isConnected: true,
  scope: CALENDAR_SCOPES.join(" "),
  accessToken: "token",
  refreshToken: "refresh",
  expiresAt: new Date(Date.now() + 3_600_000),
};

const calendarRow = (overrides: Record<string, unknown> = {}) => ({
  id: "cal-1",
  calendarId: "google-cal-1",
  name: "Team",
  description: null,
  timezone: "Europe/Rome",
  color: "#039be5",
  primary: false,
  canEdit: true,
  isEnabled: true,
  connection,
  ...overrides,
});

function googleError(status: number, reason?: string) {
  return Object.assign(new Error(`Google ${status}`), {
    code: status,
    status,
    errors: reason ? [{ reason }] : [],
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  budget.mockImplementation(async (_input, operation) => operation());
});

describe("gating", () => {
  it("returns unsupported for Microsoft without calling anything", async () => {
    prisma.calendar.findFirst.mockResolvedValue(
      calendarRow({
        connection: { ...connection, provider: "microsoft" },
      }) as never,
    );
    const result = await updateCalendar({
      emailAccountId,
      logger,
      calendarId: "cal-1",
      changes: { name: "New" },
    });
    expect(result).toEqual({ status: "unsupported" });
    expect(prisma.calendar.updateMany).not.toHaveBeenCalled();
    expect(budget).not.toHaveBeenCalled();
  });

  it("asks to reconnect when the connection lacks scopes", async () => {
    prisma.calendar.findFirst.mockResolvedValue(
      calendarRow({ connection: { ...connection, scope: null } }) as never,
    );
    expect(
      await setCalendarColor({
        emailAccountId,
        logger,
        calendarId: "cal-1",
        color: "#d50000",
      }),
    ).toEqual({ status: "reconnect_required" });
    expect(budget).not.toHaveBeenCalled();
  });

  it("asks to reconnect when a needed scope is missing", async () => {
    const withoutList = CALENDAR_SCOPES.filter(
      (scope) => !scope.endsWith("calendarlist"),
    ).join(" ");
    prisma.calendar.findFirst.mockResolvedValue(
      calendarRow({
        connection: { ...connection, scope: withoutList },
      }) as never,
    );
    // Missing scopes put the whole connection in the missing_scopes state.
    expect(
      await deleteCalendar({ emailAccountId, logger, calendarId: "cal-1" }),
    ).toEqual({ status: "reconnect_required" });
  });

  it("treats a calendar of another account as not found", async () => {
    prisma.calendar.findFirst.mockResolvedValue(null);
    const result = await deleteCalendar({
      emailAccountId,
      logger,
      calendarId: "foreign",
    });
    expect(result).toEqual({ status: "not_found" });
    expect(prisma.calendar.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "foreign",
          connection: { emailAccountId: "account-1" },
        },
      }),
    );
    expect(budget).not.toHaveBeenCalled();
    expect(prisma.calendar.deleteMany).not.toHaveBeenCalled();
  });
});

describe("createCalendar", () => {
  beforeEach(() => {
    prisma.calendarConnection.findFirst.mockResolvedValue(connection as never);
  });

  it("inserts at Google then upserts the local row and applies the color", async () => {
    client.calendars.insert.mockResolvedValue({
      data: {
        id: "new@group.calendar.google.com",
        summary: "Side",
        timeZone: "UTC",
      },
    });
    client.calendarList.patch.mockResolvedValue({
      data: { backgroundColor: "#d50000" },
    });
    prisma.calendar.upsert.mockResolvedValue({
      id: "cal-new",
      name: "Side",
    } as never);

    const result = await createCalendar({
      emailAccountId,
      logger,
      connectionId: "conn-1",
      name: "Side",
      timeZone: "UTC",
      color: "#d50000",
    });

    expect(result).toEqual({
      status: "ok",
      calendar: { id: "cal-new", name: "Side" },
    });
    expect(client.calendars.insert).toHaveBeenCalledWith({
      requestBody: { summary: "Side", description: undefined, timeZone: "UTC" },
    });
    expect(prisma.calendar.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          connectionId_calendarId: {
            connectionId: "conn-1",
            calendarId: "new@group.calendar.google.com",
          },
        },
      }),
    );
    expect(client.calendarList.patch).toHaveBeenCalledWith({
      calendarId: "new@group.calendar.google.com",
      colorRgbFormat: true,
      requestBody: { backgroundColor: "#d50000", foregroundColor: "#ffffff" },
    });
    expect(prisma.calendar.updateMany).toHaveBeenCalledWith({
      where: { id: "cal-new" },
      data: { color: "#d50000" },
    });
    expect(budget).toHaveBeenCalledTimes(2);
  });

  it("keeps the calendar when only the color step is refused", async () => {
    client.calendars.insert.mockResolvedValue({
      data: { id: "new", summary: "Side" },
    });
    client.calendarList.patch.mockRejectedValue(googleError(403));
    prisma.calendar.upsert.mockResolvedValue({
      id: "cal-new",
      name: "Side",
    } as never);

    const result = await createCalendar({
      emailAccountId,
      logger,
      connectionId: "conn-1",
      name: "Side",
      color: "#d50000",
    });
    expect(result.status).toBe("ok");
    expect(prisma.calendar.updateMany).not.toHaveBeenCalled();
  });

  it("stores nothing when the budget pauses the insert", async () => {
    budget.mockRejectedValue(new CalendarSyncPausedError(30_000));
    const result = await createCalendar({
      emailAccountId,
      logger,
      connectionId: "conn-1",
      name: "Side",
    });
    expect(result).toEqual({ status: "paused", retryAfterMs: 30_000 });
    expect(client.calendars.insert).not.toHaveBeenCalled();
    expect(prisma.calendar.upsert).not.toHaveBeenCalled();
  });

  it("rejects a connection of another account", async () => {
    prisma.calendarConnection.findFirst.mockResolvedValue(null);
    expect(
      await createCalendar({
        emailAccountId,
        logger,
        connectionId: "foreign",
        name: "Side",
      }),
    ).toEqual({ status: "not_found" });
  });
});

describe("updateCalendar", () => {
  it("applies locally first, then takes the provider answer", async () => {
    prisma.calendar.findFirst.mockResolvedValue(calendarRow() as never);
    client.calendars.patch.mockResolvedValue({
      data: {
        summary: "Renamed by Google",
        description: null,
        timeZone: "Europe/Rome",
      },
    });

    const result = await updateCalendar({
      emailAccountId,
      logger,
      calendarId: "cal-1",
      changes: { name: "Renamed" },
    });

    expect(result).toEqual({ status: "ok" });
    const calls = prisma.calendar.updateMany.mock.calls;
    expect(calls[0][0]).toEqual({
      where: { id: "cal-1" },
      data: { name: "Renamed" },
    });
    expect(calls[1][0]).toEqual({
      where: { id: "cal-1" },
      data: {
        name: "Renamed by Google",
        description: null,
        timezone: "Europe/Rome",
      },
    });
    expect(client.calendars.patch).toHaveBeenCalledWith({
      calendarId: "google-cal-1",
      requestBody: {
        summary: "Renamed",
        description: undefined,
        timeZone: undefined,
      },
    });
  });

  it("restores the previous values when the provider refuses", async () => {
    prisma.calendar.findFirst.mockResolvedValue(calendarRow() as never);
    client.calendars.patch.mockRejectedValue(googleError(403));

    const result = await updateCalendar({
      emailAccountId,
      logger,
      calendarId: "cal-1",
      changes: { name: "Renamed" },
    });

    expect(result).toEqual({ status: "read_only" });
    expect(prisma.calendar.updateMany).toHaveBeenLastCalledWith({
      where: { id: "cal-1" },
      data: { name: "Team", description: null, timezone: "Europe/Rome" },
    });
  });

  it("restores the previous values and reports a pause on rate limit", async () => {
    prisma.calendar.findFirst.mockResolvedValue(calendarRow() as never);
    budget.mockRejectedValue(new CalendarSyncPausedError(45_000));

    const result = await updateCalendar({
      emailAccountId,
      logger,
      calendarId: "cal-1",
      changes: { timeZone: "UTC" },
    });

    expect(result).toEqual({ status: "paused", retryAfterMs: 45_000 });
    expect(prisma.calendar.updateMany).toHaveBeenLastCalledWith({
      where: { id: "cal-1" },
      data: { name: "Team", description: null, timezone: "Europe/Rome" },
    });
  });

  it("refuses to rename the primary calendar and read-only calendars", async () => {
    prisma.calendar.findFirst.mockResolvedValueOnce(
      calendarRow({ primary: true }) as never,
    );
    expect(
      await updateCalendar({
        emailAccountId,
        logger,
        calendarId: "cal-1",
        changes: { name: "Mine" },
      }),
    ).toEqual({ status: "primary_protected" });

    prisma.calendar.findFirst.mockResolvedValueOnce(
      calendarRow({ canEdit: false }) as never,
    );
    expect(
      await updateCalendar({
        emailAccountId,
        logger,
        calendarId: "cal-1",
        changes: { name: "Theirs" },
      }),
    ).toEqual({ status: "read_only" });
    expect(client.calendars.patch).not.toHaveBeenCalled();
  });
});

describe("setCalendarColor", () => {
  it("writes the RGB pair and keeps the provider's color", async () => {
    prisma.calendar.findFirst.mockResolvedValue(calendarRow() as never);
    client.calendarList.patch.mockResolvedValue({
      data: { backgroundColor: "#f6bf26" },
    });

    const result = await setCalendarColor({
      emailAccountId,
      logger,
      calendarId: "cal-1",
      color: "#f6bf26",
    });

    expect(result).toEqual({ status: "ok" });
    expect(client.calendarList.patch).toHaveBeenCalledWith({
      calendarId: "google-cal-1",
      colorRgbFormat: true,
      requestBody: { backgroundColor: "#f6bf26", foregroundColor: "#000000" },
    });
    expect(prisma.calendar.updateMany).toHaveBeenLastCalledWith({
      where: { id: "cal-1" },
      data: { color: "#f6bf26" },
    });
  });

  it("restores the old color on failure", async () => {
    prisma.calendar.findFirst.mockResolvedValue(calendarRow() as never);
    client.calendarList.patch.mockRejectedValue(googleError(401));

    expect(
      await setCalendarColor({
        emailAccountId,
        logger,
        calendarId: "cal-1",
        color: "#d50000",
      }),
    ).toEqual({ status: "reconnect_required" });
    expect(prisma.calendar.updateMany).toHaveBeenLastCalledWith({
      where: { id: "cal-1" },
      data: { color: "#039be5" },
    });
  });
});

describe("setCalendarsVisibility", () => {
  const rows = [
    { id: "a", calendarId: "ga", isEnabled: true, connection },
    { id: "b", calendarId: "gb", isEnabled: true, connection },
    { id: "c", calendarId: "gc", isEnabled: false, connection },
  ];

  it("updates only calendars that change, locally and at the provider", async () => {
    prisma.calendar.findMany.mockResolvedValue(rows as never);
    prisma.$transaction.mockResolvedValue([] as never);
    client.calendarList.patch.mockResolvedValue({ data: {} });

    const result = await setCalendarsVisibility({
      emailAccountId,
      logger,
      changes: [
        { calendarId: "a", isEnabled: true },
        { calendarId: "b", isEnabled: false },
        { calendarId: "c", isEnabled: true },
      ],
    });

    expect(result).toEqual({ status: "ok", providerSynced: true });
    expect(prisma.calendar.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c"] } },
      data: { isEnabled: true },
    });
    expect(prisma.calendar.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["b"] } },
      data: { isEnabled: false },
    });
    expect(client.calendarList.patch).toHaveBeenCalledTimes(2);
    expect(client.calendarList.patch).toHaveBeenCalledWith({
      calendarId: "gb",
      requestBody: { selected: false },
    });
  });

  it("keeps the local change and stops at a rate-limit pause", async () => {
    prisma.calendar.findMany.mockResolvedValue([rows[1], rows[2]] as never);
    prisma.$transaction.mockResolvedValue([] as never);
    budget.mockRejectedValue(new CalendarSyncPausedError());

    const result = await setCalendarsVisibility({
      emailAccountId,
      logger,
      changes: [
        { calendarId: "b", isEnabled: false },
        { calendarId: "c", isEnabled: true },
      ],
    });

    expect(result).toEqual({ status: "ok", providerSynced: false });
    expect(budget).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("changes nothing when a calendar belongs to someone else", async () => {
    prisma.calendar.findMany.mockResolvedValue([rows[0]] as never);
    const result = await setCalendarsVisibility({
      emailAccountId,
      logger,
      changes: [
        { calendarId: "a", isEnabled: false },
        { calendarId: "foreign", isEnabled: false },
      ],
    });
    expect(result).toEqual({ status: "not_found" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("still saves locally for a connection that needs a reconnect", async () => {
    prisma.calendar.findMany.mockResolvedValue([
      { ...rows[0], connection: { ...connection, scope: null } },
    ] as never);
    prisma.$transaction.mockResolvedValue([] as never);

    const result = await setCalendarsVisibility({
      emailAccountId,
      logger,
      changes: [{ calendarId: "a", isEnabled: false }],
    });
    expect(result).toEqual({ status: "ok", providerSynced: false });
    expect(budget).not.toHaveBeenCalled();
  });
});

describe("deleteCalendar", () => {
  it("never deletes the primary calendar", async () => {
    prisma.calendar.findFirst.mockResolvedValue(
      calendarRow({ primary: true }) as never,
    );
    expect(
      await deleteCalendar({ emailAccountId, logger, calendarId: "cal-1" }),
    ).toEqual({ status: "primary_protected" });
    expect(budget).not.toHaveBeenCalled();
    expect(prisma.calendar.deleteMany).not.toHaveBeenCalled();
  });

  it("also trusts the provider's view of primary", async () => {
    prisma.calendar.findFirst.mockResolvedValue(calendarRow() as never);
    client.calendarList.get.mockResolvedValue({ data: { primary: true } });
    expect(
      await deleteCalendar({ emailAccountId, logger, calendarId: "cal-1" }),
    ).toEqual({ status: "primary_protected" });
    expect(client.calendars.delete).not.toHaveBeenCalled();
    expect(prisma.calendar.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes an owned secondary calendar and then its local row", async () => {
    prisma.calendar.findFirst.mockResolvedValue(calendarRow() as never);
    client.calendarList.get.mockResolvedValue({
      data: { accessRole: "owner" },
    });
    client.calendars.delete.mockResolvedValue({});

    const result = await deleteCalendar({
      emailAccountId,
      logger,
      calendarId: "cal-1",
    });

    expect(result).toEqual({ status: "ok", removal: "deleted" });
    expect(client.calendars.delete).toHaveBeenCalledWith({
      calendarId: "google-cal-1",
    });
    expect(client.calendarList.delete).not.toHaveBeenCalled();
    expect(budget).toHaveBeenCalledWith(
      { emailAccountId, provider: "google", cost: 2 },
      expect.any(Function),
    );
    expect(prisma.calendar.deleteMany).toHaveBeenCalledWith({
      where: { id: "cal-1", connection: { emailAccountId } },
    });
  });

  it("removes a subscribed calendar from the list instead of deleting it", async () => {
    prisma.calendar.findFirst.mockResolvedValue(calendarRow() as never);
    client.calendarList.get.mockResolvedValue({
      data: { accessRole: "reader" },
    });
    client.calendarList.delete.mockResolvedValue({});

    const result = await deleteCalendar({
      emailAccountId,
      logger,
      calendarId: "cal-1",
    });

    expect(result).toEqual({ status: "ok", removal: "unsubscribed" });
    expect(client.calendars.delete).not.toHaveBeenCalled();
    expect(client.calendarList.delete).toHaveBeenCalled();
  });

  it("drops the local row when the calendar is already gone at Google", async () => {
    prisma.calendar.findFirst.mockResolvedValue(calendarRow() as never);
    client.calendarList.get.mockRejectedValue(googleError(404, "notFound"));

    const result = await deleteCalendar({
      emailAccountId,
      logger,
      calendarId: "cal-1",
    });
    expect(result).toEqual({ status: "ok", removal: "deleted" });
    expect(prisma.calendar.deleteMany).toHaveBeenCalled();
  });

  it("keeps the local row when the provider call is paused or refused", async () => {
    prisma.calendar.findFirst.mockResolvedValue(calendarRow() as never);
    budget.mockRejectedValue(new CalendarSyncPausedError(10_000));
    expect(
      await deleteCalendar({ emailAccountId, logger, calendarId: "cal-1" }),
    ).toEqual({ status: "paused", retryAfterMs: 10_000 });
    expect(prisma.calendar.deleteMany).not.toHaveBeenCalled();
  });
});
