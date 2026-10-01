import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateCalendarPreferencesAction } from "@/utils/actions/calendar-preferences";
import { DEFAULT_CALENDAR_PREFERENCES } from "@/utils/calendar/preferences/preferences";
import prisma from "@/utils/__mocks__/prisma";

vi.mock("@/utils/prisma");
vi.mock("@/utils/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "user-1", email: "owner@example.com" },
  })),
}));

describe("updateCalendarPreferencesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.emailAccount.findUnique.mockResolvedValue({
      email: "owner@example.com",
      account: { userId: "user-1", provider: "google" },
    } as never);
    prisma.calendarPreference.findUnique.mockResolvedValue(null);
  });

  it("merges the change over the defaults and stores it for the account", async () => {
    const result = await updateCalendarPreferencesAction("account-1", {
      weekStart: "sunday",
    });

    expect(result?.data?.preferences).toEqual({
      ...DEFAULT_CALENDAR_PREFERENCES,
      weekStart: "sunday",
    });
    expect(prisma.calendarPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { emailAccountId: "account-1" } }),
    );
  });

  it("keeps stored values that the change does not mention", async () => {
    prisma.calendarPreference.findUnique.mockResolvedValue({
      settings: { timeFormat: "12h" },
    } as never);
    const result = await updateCalendarPreferencesAction("account-1", {
      density: "compact",
    });
    expect(result?.data?.preferences).toMatchObject({
      timeFormat: "12h",
      density: "compact",
    });
  });

  it("rejects unknown keys and invalid values", async () => {
    const unknownKey = await updateCalendarPreferencesAction("account-1", {
      emailAccountId: "other",
    } as never);
    const badValue = await updateCalendarPreferencesAction("account-1", {
      defaultDurationMinutes: 1,
    });
    expect(unknownKey?.validationErrors).toBeDefined();
    expect(badValue?.validationErrors).toBeDefined();
    expect(prisma.calendarPreference.upsert).not.toHaveBeenCalled();
  });

  it("refuses an account the user does not own", async () => {
    prisma.emailAccount.findUnique.mockResolvedValue({
      email: "other@example.com",
      account: { userId: "someone-else", provider: "google" },
    } as never);
    const result = await updateCalendarPreferencesAction("account-2", {
      weekStart: "sunday",
    });
    expect(result?.serverError).toBe("Unauthorized");
    expect(prisma.calendarPreference.upsert).not.toHaveBeenCalled();
  });
});
