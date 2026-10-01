import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createScopedLogger } from "@/utils/logger";
import { CalendarSyncPausedError } from "@/utils/calendar/calendar-sync-budget";
import {
  isCalendarDue,
  syncCalendar,
  type SyncableCalendar,
} from "./sync-calendar";
import {
  type EventRowData,
  type EventSyncPage,
  type EventSyncSource,
  SyncCursorExpiredError,
} from "./types";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
// The budget is covered on its own; here it only forwards the call.
vi.mock("@/utils/calendar/calendar-sync-budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./../calendar-sync-budget")>()),
  withCalendarSyncBudget: vi.fn((_input, operation) => operation()),
}));

const logger = createScopedLogger("test");
const now = new Date("2026-10-01T12:00:00Z");
const DAY = 86_400_000;

function calendar(overrides: Partial<SyncableCalendar> = {}): SyncableCalendar {
  return {
    id: "cal-1",
    calendarId: "primary",
    timezone: "Europe/Rome",
    syncStatus: "IDLE",
    syncCursor: null,
    syncPageToken: null,
    fullSyncStartedAt: null,
    syncStartedAt: null,
    lastSyncedAt: null,
    syncWindowStart: null,
    syncWindowEnd: null,
    syncRetryAt: null,
    ...overrides,
  };
}

function row(providerEventId: string, extra: Partial<EventRowData> = {}) {
  return {
    kind: "upsert" as const,
    data: {
      providerEventId,
      title: providerEventId,
      startTime: new Date("2026-10-05T07:00:00Z"),
      endTime: new Date("2026-10-05T08:00:00Z"),
      recurrence: [],
      ...extra,
    },
  };
}

function page(overrides: Partial<EventSyncPage> = {}): EventSyncPage {
  return {
    items: [],
    nextPageToken: null,
    nextCursor: "cursor-2",
    ...overrides,
  };
}

function sourceReturning(...pages: Array<EventSyncPage | Error>) {
  const fetchPage = vi.fn<EventSyncSource["fetchPage"]>();
  for (const next of pages) {
    if (next instanceof Error) fetchPage.mockRejectedValueOnce(next);
    else fetchPage.mockResolvedValueOnce(next);
  }
  return { source: { fetchPage } satisfies EventSyncSource, fetchPage };
}

function run(
  cal: SyncableCalendar,
  source: EventSyncSource,
  options: { force?: boolean } = {},
) {
  return syncCalendar({
    calendar: cal,
    source,
    emailAccountId: "account-1",
    provider: "google",
    logger,
    now,
    ...options,
  });
}

function lastCalendarUpdate() {
  return prisma.calendar.update.mock.calls.at(-1)?.[0].data;
}

beforeEach(() => {
  prisma.calendar.updateMany.mockResolvedValue({ count: 1 });
  prisma.calendarEvent.deleteMany.mockResolvedValue({ count: 0 });
});

describe("syncCalendar full sync", () => {
  it("reads the window, stores the cursor and purges events the provider dropped", async () => {
    const { source, fetchPage } = sourceReturning(
      page({
        items: [row("a"), row("b")],
        nextPageToken: "p2",
        nextCursor: null,
      }),
      page({ items: [row("c")], nextCursor: "cursor-1" }),
    );

    await expect(run(calendar(), source)).resolves.toBe("synced");

    expect(fetchPage).toHaveBeenCalledTimes(2);
    const [first, second] = fetchPage.mock.calls.map(([request]) => request);
    expect(first.cursor).toBeNull();
    expect(first.window.from.getTime()).toBe(now.getTime() - 90 * DAY);
    expect(first.window.to.getTime()).toBe(now.getTime() + 365 * DAY);
    expect(second.pageToken).toBe("p2");
    expect(second.window).toEqual(first.window);

    expect(prisma.calendarEvent.deleteMany).toHaveBeenLastCalledWith({
      where: { calendarId: "cal-1", updatedAt: { lt: now } },
    });
    expect(lastCalendarUpdate()).toMatchObject({
      syncStatus: "IDLE",
      syncCursor: "cursor-1",
      syncPageToken: null,
      fullSyncStartedAt: null,
      lastSyncedAt: now,
    });
  });

  it("resumes an interrupted full sync from the saved page token", async () => {
    const window = {
      from: new Date(now.getTime() - 90 * DAY),
      to: new Date(now.getTime() + 365 * DAY),
    };
    const { source, fetchPage } = sourceReturning(page());

    await run(
      calendar({
        syncPageToken: "saved-page",
        fullSyncStartedAt: new Date(now.getTime() - 60_000),
        syncWindowStart: window.from,
        syncWindowEnd: window.to,
      }),
      source,
    );

    expect(fetchPage.mock.calls[0][0]).toMatchObject({
      cursor: null,
      pageToken: "saved-page",
      window,
    });
  });
});

describe("syncCalendar incremental sync", () => {
  const incremental = () =>
    calendar({
      syncCursor: "cursor-1",
      lastSyncedAt: new Date(now.getTime() - 3_600_000),
      syncWindowStart: new Date(now.getTime() - 90 * DAY),
      syncWindowEnd: new Date(now.getTime() + 300 * DAY),
    });

  it("applies changes with the stored cursor and does not purge", async () => {
    const { source, fetchPage } = sourceReturning(
      page({ items: [row("a")], nextCursor: "cursor-2" }),
    );

    await expect(run(incremental(), source)).resolves.toBe("synced");

    expect(fetchPage.mock.calls[0][0].cursor).toBe("cursor-1");
    expect(prisma.calendarEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ providerEventId: "a", calendarId: "cal-1" }),
      ],
    });
    expect(prisma.calendarEvent.deleteMany).not.toHaveBeenCalledWith({
      where: { calendarId: "cal-1", updatedAt: expect.anything() },
    });
    expect(lastCalendarUpdate()).toMatchObject({ syncCursor: "cursor-2" });
  });

  it("deletes cancelled events and the exceptions of a cancelled series", async () => {
    const { source } = sourceReturning(
      page({
        items: [
          { kind: "remove", providerEventId: "gone", withInstances: false },
          { kind: "remove", providerEventId: "series", withInstances: true },
        ],
      }),
    );

    await run(incremental(), source);

    expect(prisma.calendarEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        calendarId: "cal-1",
        OR: [
          { providerEventId: { in: ["gone", "series"] } },
          { recurringEventId: { in: ["series"] } },
        ],
      },
    });
    expect(prisma.calendarEvent.createMany).not.toHaveBeenCalled();
  });

  it("keeps a cancelled instance as a tombstone instead of deleting it", async () => {
    const { source } = sourceReturning(
      page({
        items: [
          row("series_1", { status: "CANCELLED", recurringEventId: "series" }),
        ],
      }),
    );

    await run(incremental(), source);

    expect(prisma.calendarEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ status: "CANCELLED" })],
    });
  });

  it("starts over with a full sync when the cursor is gone (410)", async () => {
    const { source, fetchPage } = sourceReturning(
      new SyncCursorExpiredError(),
      page({ items: [row("a")], nextCursor: "fresh-cursor" }),
    );

    await expect(run(incremental(), source)).resolves.toBe("synced");

    expect(fetchPage.mock.calls[0][0].cursor).toBe("cursor-1");
    expect(fetchPage.mock.calls[1][0].cursor).toBeNull();
    expect(prisma.calendar.update).toHaveBeenCalledWith({
      where: { id: "cal-1" },
      data: expect.objectContaining({
        syncCursor: null,
        fullSyncStartedAt: now,
      }),
    });
    expect(prisma.calendarEvent.deleteMany).toHaveBeenLastCalledWith({
      where: { calendarId: "cal-1", updatedAt: { lt: now } },
    });
    expect(lastCalendarUpdate()).toMatchObject({ syncCursor: "fresh-cursor" });
  });

  it("gives up after one restart instead of looping on a bad cursor", async () => {
    const { source, fetchPage } = sourceReturning(
      new SyncCursorExpiredError(),
      new SyncCursorExpiredError(),
    );

    await expect(run(incremental(), source)).resolves.toBe("error");
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("does a full sync with a new window once the old one runs short", async () => {
    const { source, fetchPage } = sourceReturning(page({ nextCursor: "c" }));

    await run(
      calendar({
        syncCursor: "cursor-1",
        lastSyncedAt: new Date(now.getTime() - 3_600_000),
        syncWindowStart: new Date(now.getTime() - 90 * DAY),
        syncWindowEnd: new Date(now.getTime() + 30 * DAY),
      }),
      source,
    );

    const request = fetchPage.mock.calls[0][0];
    expect(request.cursor).toBeNull();
    expect(request.window.to.getTime()).toBe(now.getTime() + 365 * DAY);
  });
});

describe("syncCalendar failures", () => {
  it("records a pause with the retry time when the budget refuses", async () => {
    const { source } = sourceReturning(new CalendarSyncPausedError(120_000));

    await expect(run(calendar(), source)).resolves.toBe("paused");

    expect(lastCalendarUpdate()).toEqual({
      syncStatus: "PAUSED",
      syncRetryAt: new Date(now.getTime() + 120_000),
    });
  });

  it("flags an authorization failure as needing a reconnect", async () => {
    const { source } = sourceReturning(
      Object.assign(new Error("Invalid Credentials"), { code: 401 }),
    );

    await expect(run(calendar(), source)).resolves.toBe("needs_reconnect");
    expect(lastCalendarUpdate()).toMatchObject({
      syncStatus: "NEEDS_RECONNECT",
    });
  });

  it("schedules a retry after any other failure", async () => {
    const { source } = sourceReturning(new Error("boom"));

    await expect(run(calendar(), source)).resolves.toBe("error");
    expect(lastCalendarUpdate()).toMatchObject({
      syncStatus: "ERROR",
      syncError: "Sync failed",
      syncRetryAt: new Date(now.getTime() + 15 * 60_000),
    });
  });

  it("skips a calendar another run already claimed", async () => {
    prisma.calendar.updateMany.mockResolvedValue({ count: 0 });
    const { source, fetchPage } = sourceReturning(page());

    await expect(run(calendar(), source)).resolves.toBe("skipped");
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

describe("isCalendarDue", () => {
  const base = {
    syncStatus: "IDLE" as const,
    syncRetryAt: null,
    lastSyncedAt: new Date(now.getTime() - 60_000),
    syncStartedAt: null,
  };

  it("waits out the minimum interval unless forced", () => {
    expect(isCalendarDue(base, now, false)).toBe(false);
    expect(isCalendarDue(base, now, true)).toBe(true);
    expect(isCalendarDue({ ...base, lastSyncedAt: null }, now, false)).toBe(
      true,
    );
  });

  it("never overrides a rate-limit pause, even when forced", () => {
    const paused = {
      ...base,
      syncStatus: "PAUSED" as const,
      syncRetryAt: new Date(now.getTime() + 60_000),
    };

    expect(isCalendarDue(paused, now, true)).toBe(false);
    expect(
      isCalendarDue(
        {
          ...paused,
          lastSyncedAt: null,
          syncRetryAt: new Date(now.getTime() - 1),
        },
        now,
        false,
      ),
    ).toBe(true);
  });

  it("only retries a reconnect-required calendar when forced", () => {
    const stale = {
      ...base,
      syncStatus: "NEEDS_RECONNECT" as const,
      lastSyncedAt: null,
    };

    expect(isCalendarDue(stale, now, false)).toBe(false);
    expect(isCalendarDue(stale, now, true)).toBe(true);
  });
});
