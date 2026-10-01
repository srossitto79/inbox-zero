import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCalendarAction,
  deleteCalendarAction,
  setCalendarColorAction,
  setCalendarsVisibilityAction,
  updateCalendarAction,
} from "@/utils/actions/calendar-manage";
import prisma from "@/utils/__mocks__/prisma";

const { manage } = vi.hoisted(() => ({
  manage: {
    createCalendar: vi.fn(),
    updateCalendar: vi.fn(),
    setCalendarColor: vi.fn(),
    setCalendarsVisibility: vi.fn(),
    deleteCalendar: vi.fn(),
  },
}));

vi.mock("@/utils/prisma");
vi.mock("@/utils/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "user-1", email: "owner@example.com" },
  })),
}));
vi.mock("@/utils/calendar/manage/manage-calendar", () => manage);

describe("calendar management actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.emailAccount.findUnique.mockResolvedValue({
      email: "owner@example.com",
      account: { userId: "user-1", provider: "google" },
    } as never);
    for (const fn of Object.values(manage)) {
      fn.mockResolvedValue({ status: "ok" });
    }
  });

  it("passes the bound account, never a client-supplied one", async () => {
    await deleteCalendarAction("account-1", { calendarId: "cal-1" });
    expect(manage.deleteCalendar).toHaveBeenCalledWith(
      expect.objectContaining({
        emailAccountId: "account-1",
        calendarId: "cal-1",
      }),
    );
  });

  it("refuses every action for an account the user does not own", async () => {
    prisma.emailAccount.findUnique.mockResolvedValue({
      email: "other@example.com",
      account: { userId: "someone-else", provider: "google" },
    } as never);

    const results = await Promise.all([
      createCalendarAction("account-2", {
        connectionId: "conn-1",
        name: "Side",
      }),
      updateCalendarAction("account-2", { calendarId: "c", name: "x" }),
      setCalendarColorAction("account-2", {
        calendarId: "c",
        color: "#d50000",
      }),
      setCalendarsVisibilityAction("account-2", {
        changes: [{ calendarId: "c", isEnabled: false }],
      }),
      deleteCalendarAction("account-2", { calendarId: "c" }),
    ]);

    for (const result of results)
      expect(result?.serverError).toBe("Unauthorized");
    for (const fn of Object.values(manage)) expect(fn).not.toHaveBeenCalled();
  });

  it("validates input before reaching the service", async () => {
    const results = await Promise.all([
      createCalendarAction("account-1", { connectionId: "c", name: "   " }),
      createCalendarAction("account-1", {
        connectionId: "c",
        name: "Ok",
        timeZone: "Mars/Base",
      }),
      updateCalendarAction("account-1", { calendarId: "c" }),
      setCalendarColorAction("account-1", {
        calendarId: "c",
        color: "#123456",
      }),
      setCalendarsVisibilityAction("account-1", { changes: [] }),
      deleteCalendarAction("account-1", { calendarId: "" }),
    ]);

    for (const result of results)
      expect(result?.validationErrors).toBeDefined();
    for (const fn of Object.values(manage)) expect(fn).not.toHaveBeenCalled();
  });

  it("returns typed refusals as data", async () => {
    manage.setCalendarColor.mockResolvedValue({ status: "reconnect_required" });
    const result = await setCalendarColorAction("account-1", {
      calendarId: "c",
      color: "#d50000",
    });
    expect(result?.data).toEqual({ status: "reconnect_required" });
    expect(result?.serverError).toBeUndefined();
  });

  it("splits changes from the calendar id for updates", async () => {
    await updateCalendarAction("account-1", {
      calendarId: "cal-1",
      name: " Renamed ",
      timeZone: "Europe/Rome",
    });
    expect(manage.updateCalendar).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "cal-1",
        changes: { name: "Renamed", timeZone: "Europe/Rome" },
      }),
    );
  });
});
