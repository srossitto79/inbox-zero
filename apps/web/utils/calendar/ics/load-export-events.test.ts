import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { loadIcsExport } from "@/utils/calendar/ics/load-export-events";

vi.mock("@/utils/prisma");

const row = (overrides: Record<string, unknown> = {}) => ({
  providerEventId: "p1",
  iCalUid: "uid-1",
  providerUpdatedAt: null,
  title: "Planning",
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
  attendees: null,
  recurringEventId: null,
  recurrence: [],
  originalStartTime: null,
  htmlLink: null,
  ...overrides,
});

describe("loadIcsExport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null for an event the account does not own", async () => {
    prisma.calendarEvent.findFirst.mockResolvedValue(null);
    const result = await loadIcsExport({
      emailAccountId: "account-1",
      selection: { type: "event", eventId: "event-9" },
    });
    expect(result).toBeNull();
    expect(prisma.calendarEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "event-9",
          calendar: { connection: { emailAccountId: "account-1" } },
        },
      }),
    );
  });

  it("returns null for a calendar the account does not own", async () => {
    prisma.calendar.findMany.mockResolvedValue([]);
    const result = await loadIcsExport({
      emailAccountId: "account-1",
      selection: { type: "calendar", calendarId: "cal-9" },
    });
    expect(result).toBeNull();
    expect(prisma.calendar.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "cal-9",
          connection: { emailAccountId: "account-1" },
        },
      }),
    );
    expect(prisma.calendarEvent.findMany).not.toHaveBeenCalled();
  });

  it("brings the exceptions of a series master along", async () => {
    prisma.calendarEvent.findFirst.mockResolvedValue({
      ...row({ recurrence: ["RRULE:FREQ=DAILY"] }),
      calendarId: "cal-1",
    } as never);
    prisma.calendarEvent.findMany.mockResolvedValue([
      row({
        providerEventId: "p1_20261006",
        recurringEventId: "p1",
        originalStartTime: new Date("2026-10-06T09:00:00Z"),
      }),
    ] as never);

    const result = await loadIcsExport({
      emailAccountId: "account-1",
      selection: { type: "event", eventId: "event-1" },
    });

    expect(result?.events).toHaveLength(2);
    expect(result?.events[0].recurrence).toEqual(["RRULE:FREQ=DAILY"]);
    expect(result?.events[1].originalStartTime).toEqual(
      new Date("2026-10-06T09:00:00Z"),
    );
    expect(result?.events[1].uid).toBe("uid-1");
  });

  it("flags a truncated export", async () => {
    prisma.calendar.findMany.mockResolvedValue([
      { id: "cal-1", name: "Work" },
    ] as never);
    prisma.calendarEvent.findMany.mockResolvedValue(
      Array.from({ length: 5001 }, () => row()) as never,
    );
    const result = await loadIcsExport({
      emailAccountId: "account-1",
      selection: { type: "calendar", calendarId: "cal-1" },
    });
    expect(result?.name).toBe("Work");
    expect(result?.events).toHaveLength(5000);
    expect(result?.truncated).toBe(true);
  });
});
