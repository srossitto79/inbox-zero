import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/generated/prisma/client";
import { createScopedLogger } from "@/utils/logger";
import { syncCalendar } from "@/utils/calendar/sync/sync-calendar";
import type { EventRowData } from "@/utils/calendar/sync/types";
import {
  createEventLocalFirst,
  deleteEventLocalFirst,
  moveEventLocalFirst,
  respondToEventLocalFirst,
  setRemindersLocalFirst,
  updateEventLocalFirst,
} from "@/utils/calendar/write/local-first";
import type {
  CalendarEventWriter,
  WriteFailure,
  WriteResult,
} from "@/utils/calendar/write/types";

const store = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  counter: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/utils/calendar/calendar-sync-budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../calendar-sync-budget")>()),
  withCalendarSyncBudget: vi.fn((_input, operation) => operation()),
}));
vi.mock("@/utils/prisma", () => {
  type Where = Record<string, unknown>;
  const matches = (row: Record<string, unknown>, where: Where): boolean =>
    Object.entries(where).every(([key, condition]) => {
      if (key === "OR") {
        return (condition as Where[]).some((part) => matches(row, part));
      }
      if (condition && typeof condition === "object") {
        const op = condition as { in?: unknown[]; lt?: Date };
        if (op.in) return op.in.includes(row[key]);
        if (op.lt) return (row[key] as Date) < op.lt;
      }
      return row[key] === condition;
    });
  const insert = (data: Record<string, unknown>) => {
    const row: Record<string, unknown> = {
      id: `row-${++store.counter}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    };
    const duplicate = store.rows.some(
      (existing) =>
        existing.calendarId === row.calendarId &&
        existing.providerEventId === row.providerEventId,
    );
    if (duplicate) throw new Error("Unique constraint failed");
    store.rows.push(row);
    return row;
  };
  const calendarEvent = {
    findUnique: async ({
      where: { calendarId_providerEventId: key },
    }: {
      where: { calendarId_providerEventId: Where };
    }) => {
      const found = store.rows.find((row) => matches(row, key));
      return found ? { ...found } : null;
    },
    updateMany: async ({ where, data }: { where: Where; data: Where }) => {
      const hits = store.rows.filter((row) => matches(row, where));
      for (const row of hits)
        Object.assign(row, data, { updatedAt: new Date() });
      return { count: hits.length };
    },
    create: async ({ data }: { data: Where }) => ({ ...insert(data) }),
    createMany: async ({ data }: { data: Where[] }) => {
      for (const item of data) insert(item);
      return { count: data.length };
    },
    deleteMany: async ({ where }: { where: Where }) => {
      const before = store.rows.length;
      store.rows = store.rows.filter((row) => !matches(row, where));
      return { count: before - store.rows.length };
    },
  };
  const prisma = {
    calendarEvent,
    calendar: {
      updateMany: async () => ({ count: 1 }),
      update: async () => ({}),
    },
    $transaction: async (operations: Promise<unknown>[]) => {
      const results = [];
      for (const operation of operations) results.push(await operation);
      return results;
    },
  };
  return { default: prisma };
});

const calendar = { id: "cal-1", providerCalendarId: "primary" };

const timed = {
  isAllDay: false as const,
  start: new Date("2026-10-05T07:00:00Z"),
  end: new Date("2026-10-05T08:00:00Z"),
  timeZone: "Europe/Rome",
};

function providerRow(
  providerEventId: string,
  extra: Partial<EventRowData> = {},
): EventRowData {
  return {
    providerEventId,
    iCalUid: `${providerEventId}@google.com`,
    etag: '"etag-2"',
    providerUpdatedAt: new Date("2026-10-05T06:00:00Z"),
    title: "Planning",
    startTime: timed.start,
    endTime: timed.end,
    timezone: "Europe/Rome",
    htmlLink: `https://calendar.google.com/${providerEventId}`,
    recurrence: [],
    ...extra,
  };
}

function seed(extra: Partial<EventRowData> = {}) {
  const row = {
    id: `row-${++store.counter}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    calendarId: "cal-1",
    iCalUid: "evt1@google.com",
    etag: '"etag-1"',
    providerUpdatedAt: null,
    description: null,
    location: null,
    isAllDay: false,
    status: "CONFIRMED",
    isBusy: true,
    organizerEmail: "me@example.com",
    organizerName: null,
    isOrganizer: true,
    selfResponseStatus: null,
    attendees: null,
    recurringEventId: null,
    originalStartTime: null,
    videoLink: null,
    htmlLink: null,
    reminders: null,
    ...providerRow("evt1", { etag: '"etag-1"', title: "Original" }),
    ...extra,
  };
  store.rows.push(row);
  return { ...row } as unknown as CalendarEvent;
}

function failure(
  reason: WriteFailure["reason"],
  message: string = reason,
): WriteFailure {
  return { ok: false, reason, message };
}

function writerMock(overrides: Partial<CalendarEventWriter> = {}) {
  const unexpected = async () => {
    throw new Error("Unexpected provider call");
  };
  return {
    createEvent: vi.fn(unexpected),
    updateEvent: vi.fn(unexpected),
    moveEvent: vi.fn(unexpected),
    deleteEvent: vi.fn(unexpected),
    respondToEvent: vi.fn(unexpected),
    setReminders: vi.fn(unexpected),
    fetchEvent: vi.fn(unexpected),
    ...overrides,
  } satisfies CalendarEventWriter;
}

const ok = <T>(value: T): WriteResult<T> => ({ ok: true, value });

function rowsFor(providerEventId: string) {
  return store.rows.filter((row) => row.providerEventId === providerEventId);
}

beforeEach(() => {
  store.rows = [];
  store.counter = 0;
});

describe("createEventLocalFirst", () => {
  it("shows the event before the provider answers, then adopts its data", async () => {
    let release!: (value: WriteResult<EventRowData>) => void;
    const writer = writerMock({
      createEvent: vi.fn(
        () => new Promise<WriteResult<EventRowData>>((r) => (release = r)),
      ),
    });

    const pending = createEventLocalFirst({
      writer,
      calendar,
      organizerEmail: "me@example.com",
      providerEventId: "new1",
      input: {
        title: "Planning",
        timing: timed,
        guests: [{ email: "guest@example.com" }],
        sendUpdates: "all",
      },
    });
    await vi.waitFor(() => expect(rowsFor("new1")).toHaveLength(1));
    expect(rowsFor("new1")[0]).toMatchObject({
      title: "Planning",
      isOrganizer: true,
    });

    release(ok(providerRow("new1")));
    const result = await pending;

    expect(result).toMatchObject({
      ok: true,
      event: { etag: '"etag-2"', htmlLink: "https://calendar.google.com/new1" },
    });
    expect(rowsFor("new1")).toHaveLength(1);
  });

  it("removes the row when the provider refuses", async () => {
    const writer = writerMock({
      createEvent: vi.fn(async () => failure("forbidden")),
    });

    const result = await createEventLocalFirst({
      writer,
      calendar,
      organizerEmail: "me@example.com",
      providerEventId: "new1",
      input: { title: "x", timing: timed, guests: [], sendUpdates: "none" },
    });

    expect(result).toMatchObject({ ok: false });
    expect(store.rows).toHaveLength(0);
  });

  it("does not duplicate when the sync sees the event before the reply", async () => {
    let release!: (value: WriteResult<EventRowData>) => void;
    const writer = writerMock({
      createEvent: vi.fn(
        () => new Promise<WriteResult<EventRowData>>((r) => (release = r)),
      ),
    });
    const pending = createEventLocalFirst({
      writer,
      calendar,
      organizerEmail: "me@example.com",
      providerEventId: "new1",
      input: {
        title: "Planning",
        timing: timed,
        guests: [],
        sendUpdates: "none",
      },
    });
    await vi.waitFor(() => expect(rowsFor("new1")).toHaveLength(1));

    const fetchPage = vi.fn().mockResolvedValue({
      items: [{ kind: "upsert", data: providerRow("new1") }],
      nextPageToken: null,
      nextCursor: "cursor-1",
    });
    await syncCalendar({
      calendar: {
        id: "cal-1",
        calendarId: "primary",
        timezone: "Europe/Rome",
        syncStatus: "IDLE",
        syncCursor: "cursor-0",
        syncPageToken: null,
        fullSyncStartedAt: null,
        syncStartedAt: null,
        lastSyncedAt: null,
        syncWindowStart: new Date("2026-01-01"),
        syncWindowEnd: new Date("2027-12-31"),
        syncRetryAt: null,
      },
      source: { fetchPage },
      emailAccountId: "account-1",
      provider: "google",
      logger: createScopedLogger("test"),
      now: new Date("2026-10-05T06:30:00Z"),
    });
    release(ok(providerRow("new1", { etag: '"etag-3"' })));
    const result = await pending;

    expect(rowsFor("new1")).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, event: { etag: '"etag-3"' } });
  });
});

describe("updateEventLocalFirst", () => {
  it("sends the stored etag and stores the provider's reply", async () => {
    const row = seed();
    const writer = writerMock({
      updateEvent: vi.fn(async () =>
        ok(providerRow("evt1", { title: "Renamed" })),
      ),
    });

    const result = await updateEventLocalFirst({
      writer,
      calendar,
      row,
      patch: { title: "Renamed" },
      sendUpdates: "none",
    });

    expect(writer.updateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ etag: '"etag-1"', providerEventId: "evt1" }),
    );
    expect(result).toMatchObject({
      ok: true,
      event: { title: "Renamed", etag: '"etag-2"' },
    });
    expect(rowsFor("evt1")).toHaveLength(1);
  });

  it("rolls the row back when the provider fails", async () => {
    const row = seed();
    const writer = writerMock({
      updateEvent: vi.fn(async () => {
        expect(rowsFor("evt1")[0].title).toBe("Renamed");
        return failure("failed");
      }),
    });

    const result = await updateEventLocalFirst({
      writer,
      calendar,
      row,
      patch: { title: "Renamed", location: "Room 2" },
      sendUpdates: "none",
    });

    expect(result).toMatchObject({ ok: false, failure: { reason: "failed" } });
    expect(rowsFor("evt1")).toHaveLength(1);
    expect(rowsFor("evt1")[0]).toMatchObject({
      title: "Original",
      location: null,
      etag: '"etag-1"',
    });
  });

  it("adopts the provider's copy on an etag conflict and reports it", async () => {
    const row = seed();
    const writer = writerMock({
      updateEvent: vi.fn(async () => failure("conflict", "Event changed")),
      fetchEvent: vi.fn(async () =>
        ok(
          providerRow("evt1", { title: "Changed elsewhere", etag: '"etag-9"' }),
        ),
      ),
    });

    const result = await updateEventLocalFirst({
      writer,
      calendar,
      row,
      patch: { title: "Mine" },
      sendUpdates: "none",
    });

    expect(result).toMatchObject({
      ok: false,
      failure: { reason: "conflict" },
      event: { title: "Changed elsewhere", etag: '"etag-9"' },
    });
    expect(rowsFor("evt1")).toHaveLength(1);
    expect(rowsFor("evt1")[0].title).toBe("Changed elsewhere");
  });

  it("drops the row when the event no longer exists upstream", async () => {
    const row = seed();
    const writer = writerMock({
      updateEvent: vi.fn(async () => failure("not_found")),
    });

    await updateEventLocalFirst({
      writer,
      calendar,
      row,
      patch: { title: "x" },
      sendUpdates: "none",
    });

    expect(store.rows).toHaveLength(0);
  });

  it("keeps the response of guests already on the event", async () => {
    const row = seed({
      attendees: [
        { email: "me@example.com", responseStatus: "accepted", isSelf: true },
        { email: "a@example.com", responseStatus: "declined" },
      ],
    });
    const writer = writerMock({
      updateEvent: vi.fn(async () => {
        expect(rowsFor("evt1")[0].attendees).toEqual([
          { email: "a@example.com", responseStatus: "declined" },
          { email: "b@example.com", responseStatus: "needsAction" },
        ]);
        return failure("failed");
      }),
    });

    await updateEventLocalFirst({
      writer,
      calendar,
      row,
      patch: {
        guests: [{ email: "a@example.com" }, { email: "b@example.com" }],
      },
      sendUpdates: "all",
    });
  });

  it("refuses recurring events without calling the provider", async () => {
    const row = seed({ recurrence: ["RRULE:FREQ=WEEKLY"] });
    const writer = writerMock();

    const result = await updateEventLocalFirst({
      writer,
      calendar,
      row,
      patch: { title: "x" },
      sendUpdates: "none",
    });

    expect(result).toMatchObject({
      ok: false,
      failure: { reason: "unsupported" },
    });
    expect(writer.updateEvent).not.toHaveBeenCalled();
  });
});

describe("moveEventLocalFirst", () => {
  it("shows the new time at once and keeps the duration", async () => {
    const row = seed();
    const writer = writerMock({
      moveEvent: vi.fn(async () => {
        expect(rowsFor("evt1")[0]).toMatchObject({
          startTime: new Date("2026-10-06T09:30:00Z"),
          endTime: new Date("2026-10-06T10:30:00Z"),
        });
        return ok(
          providerRow("evt1", {
            startTime: new Date("2026-10-06T09:30:00Z"),
            endTime: new Date("2026-10-06T10:30:00Z"),
          }),
        );
      }),
    });

    const result = await moveEventLocalFirst({
      writer,
      calendar,
      row,
      newStart: new Date("2026-10-06T09:30:00Z"),
      sendUpdates: "none",
    });

    expect(result.ok).toBe(true);
  });

  it("moves an all-day event by whole days", async () => {
    const row = seed({
      isAllDay: true,
      timezone: null,
      startTime: new Date("2026-10-05T00:00:00Z"),
      endTime: new Date("2026-10-07T00:00:00Z"),
    });
    const writer = writerMock({
      moveEvent: vi.fn(async () => failure("failed")),
    });

    await moveEventLocalFirst({
      writer,
      calendar,
      row,
      newStart: "2026-10-30",
      sendUpdates: "none",
    });

    expect(writer.moveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        current: {
          isAllDay: true,
          startDate: "2026-10-05",
          endDate: "2026-10-07",
        },
        newStart: "2026-10-30",
      }),
    );
    expect(rowsFor("evt1")[0].startTime).toEqual(
      new Date("2026-10-05T00:00:00Z"),
    );
  });
});

describe("deleteEventLocalFirst", () => {
  it("removes the row at once and keeps it removed", async () => {
    const row = seed();
    const writer = writerMock({
      deleteEvent: vi.fn(async () => {
        expect(store.rows).toHaveLength(0);
        return ok(null);
      }),
    });

    const result = await deleteEventLocalFirst({
      writer,
      calendar,
      row,
      sendUpdates: "all",
    });

    expect(result).toEqual({ ok: true });
    expect(store.rows).toHaveLength(0);
  });

  it("restores the row when the provider refuses", async () => {
    const row = seed({ title: "Keep me" });
    const writer = writerMock({
      deleteEvent: vi.fn(async () => failure("forbidden")),
    });

    const result = await deleteEventLocalFirst({
      writer,
      calendar,
      row,
      sendUpdates: "none",
    });

    expect(result).toMatchObject({ ok: false });
    expect(rowsFor("evt1")).toHaveLength(1);
    expect(rowsFor("evt1")[0]).toMatchObject({
      title: "Keep me",
      etag: '"etag-1"',
    });
  });
});

describe("respondToEventLocalFirst", () => {
  const attendees = [
    {
      email: "host@example.com",
      isOrganizer: true,
      responseStatus: "accepted",
    },
    { email: "me@example.com", isSelf: true, responseStatus: "needsAction" },
    { email: "c@example.com", responseStatus: "tentative" },
  ];

  it("changes only the viewer's answer and keeps the other guests", async () => {
    const row = seed({ attendees, selfResponseStatus: "needsAction" });
    const writer = writerMock({
      respondToEvent: vi.fn(async () =>
        // Google may answer an RSVP with a reduced guest list.
        ok(
          providerRow("evt1", { attendees: [attendees[1]], etag: '"etag-5"' }),
        ),
      ),
    });

    const result = await respondToEventLocalFirst({
      writer,
      calendar,
      row,
      response: "accepted",
      sendUpdates: "all",
    });

    expect(writer.respondToEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        selfEmail: "me@example.com",
        response: "accepted",
        sendUpdates: "all",
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      event: { etag: '"etag-5"', selfResponseStatus: "accepted" },
    });
    const stored = rowsFor("evt1")[0].attendees as Array<{
      email: string;
      responseStatus: string;
    }>;
    expect(stored.map((a) => [a.email, a.responseStatus])).toEqual([
      ["host@example.com", "accepted"],
      ["me@example.com", "accepted"],
      ["c@example.com", "tentative"],
    ]);
  });

  it("restores the previous answer on failure", async () => {
    const row = seed({ attendees, selfResponseStatus: "needsAction" });
    const writer = writerMock({
      respondToEvent: vi.fn(async () => failure("failed")),
    });

    await respondToEventLocalFirst({
      writer,
      calendar,
      row,
      response: "declined",
      sendUpdates: "none",
    });

    expect(rowsFor("evt1")[0].selfResponseStatus).toBe("needsAction");
  });

  it("refuses when the viewer is not a guest", async () => {
    const row = seed({ attendees: [attendees[0]] });
    const writer = writerMock();

    const result = await respondToEventLocalFirst({
      writer,
      calendar,
      row,
      response: "accepted",
      sendUpdates: "none",
    });

    expect(result).toMatchObject({ ok: false, failure: { reason: "invalid" } });
    expect(writer.respondToEvent).not.toHaveBeenCalled();
  });
});

describe("setRemindersLocalFirst", () => {
  it("stores the reminders the provider confirms", async () => {
    const row = seed();
    const writer = writerMock({
      setReminders: vi.fn(async () =>
        ok(
          providerRow("evt1", {
            reminders: {
              useDefault: false,
              overrides: [{ method: "popup", minutes: 10 }],
            },
          }),
        ),
      ),
    });

    const result = await setRemindersLocalFirst({
      writer,
      calendar,
      row,
      reminders: {
        useDefault: false,
        overrides: [{ method: "popup", minutes: 10 }],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      event: {
        reminders: {
          useDefault: false,
          overrides: [{ method: "popup", minutes: 10 }],
        },
      },
    });
  });
});
