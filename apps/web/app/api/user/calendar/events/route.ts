import { NextResponse } from "next/server";
import { z } from "zod";
import { withEmailAccount } from "@/utils/middleware";
import prisma from "@/utils/prisma";
import {
  ALL_DAY_PADDING_MS,
  expandStoredEvents,
} from "@/utils/calendar/expand-events";
import { isValidTimeZone } from "@/utils/calendar/zoned-time";

const MAX_RANGE_MS = 62 * 24 * 60 * 60 * 1000;

const querySchema = z
  .object({
    from: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
    to: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
    timezone: z.string().min(1),
  })
  .refine(({ from, to }) => to > from, {
    message: "End must be after start",
  })
  .refine(({ from, to }) => to.getTime() - from.getTime() <= MAX_RANGE_MS, {
    message: "Date range is too large",
  })
  .refine(({ timezone }) => isValidTimeZone(timezone), {
    message: "Invalid time zone",
  });

export type GetCalendarEventsResponse = Awaited<ReturnType<typeof getData>>;

export const GET = withEmailAccount("user/calendar/events", async (request) => {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid date range" },
      { status: 400 },
    );
  }

  const result = await getData({
    emailAccountId: request.auth.emailAccountId,
    ...parsed.data,
  });
  return NextResponse.json(result);
});

async function getData({
  emailAccountId,
  from,
  to,
  timezone,
}: {
  emailAccountId: string;
  from: Date;
  to: Date;
  timezone: string;
}) {
  const calendars = await prisma.calendar.findMany({
    where: {
      isEnabled: true,
      connection: { emailAccountId, isConnected: true },
    },
    select: { id: true, name: true, color: true },
  });
  if (calendars.length === 0) {
    return { events: [], from: from.toISOString(), to: to.toISOString() };
  }

  const calendarIds = calendars.map((calendar) => calendar.id);
  const paddedFrom = new Date(from.getTime() - ALL_DAY_PADDING_MS);
  const paddedTo = new Date(to.getTime() + ALL_DAY_PADDING_MS);
  const storedEvents = await prisma.calendarEvent.findMany({
    where: {
      calendarId: { in: calendarIds },
      OR: [
        // Series masters can begin before the synced window; their rules decide
        // whether an occurrence intersects this request.
        { recurrence: { isEmpty: false } },
        { startTime: { lt: paddedTo }, endTime: { gt: paddedFrom } },
        // A moved or cancelled exception must still suppress its original slot.
        {
          originalStartTime: { gte: paddedFrom, lt: paddedTo },
          recurringEventId: { not: null },
        },
      ],
    },
    select: {
      id: true,
      calendarId: true,
      providerEventId: true,
      title: true,
      description: true,
      location: true,
      startTime: true,
      endTime: true,
      isAllDay: true,
      timezone: true,
      status: true,
      isBusy: true,
      organizerEmail: true,
      organizerName: true,
      isOrganizer: true,
      selfResponseStatus: true,
      attendees: true,
      recurringEventId: true,
      recurrence: true,
      originalStartTime: true,
      videoLink: true,
      htmlLink: true,
    },
  });

  return {
    events: expandStoredEvents({
      events: storedEvents,
      calendars: new Map(calendars.map((calendar) => [calendar.id, calendar])),
      range: { from, to },
      viewerTimeZone: timezone,
    }),
    from: from.toISOString(),
    to: to.toISOString(),
  };
}
