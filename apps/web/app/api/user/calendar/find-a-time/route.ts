import { NextResponse } from "next/server";
import { z } from "zod";
import { withEmailAccount } from "@/utils/middleware";
import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import { findFreeSlots } from "@/utils/calendar/find-a-time/find-free-slots";
import {
  loadGuestAvailability,
  loadOwnBusy,
} from "@/utils/calendar/find-a-time/load-busy";
import { resolveCalendarPreferences } from "@/utils/calendar/preferences/preferences";
import { isValidTimeZone } from "@/utils/calendar/zoned-time";

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_ATTENDEES = 20;

const querySchema = z
  .object({
    attendee: z.array(z.string().email()).max(MAX_ATTENDEES),
    from: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
    to: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
    durationMinutes: z.coerce.number().int().min(5).max(480),
    timezone: z.string().refine(isValidTimeZone, "Invalid time zone"),
    limit: z.coerce.number().int().min(1).max(30).default(10),
    includeOutsideWorkingHours: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .refine(({ from, to }) => to > from, { message: "End must be after start" })
  .refine(({ from, to }) => to.getTime() - from.getTime() <= MAX_RANGE_MS, {
    message: "Date range is too large",
  });

export type GetFindATimeResponse = Awaited<ReturnType<typeof getData>>;

export const GET = withEmailAccount(
  "user/calendar/find-a-time",
  async (request) => {
    const searchParams = new URL(request.url).searchParams;
    const parsed = querySchema.safeParse({
      ...Object.fromEntries(searchParams),
      attendee: searchParams.getAll("attendee"),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }

    const result = await getData({
      emailAccountId: request.auth.emailAccountId,
      logger: request.logger,
      ...parsed.data,
    });
    return NextResponse.json(result);
  },
);

async function getData({
  emailAccountId,
  logger,
  attendee,
  from,
  to,
  durationMinutes,
  timezone,
  limit,
  includeOutsideWorkingHours,
}: z.infer<typeof querySchema> & {
  emailAccountId: string;
  logger: Logger;
}) {
  const [stored, ownEmails] = await Promise.all([
    prisma.calendarPreference.findUnique({
      where: { emailAccountId },
      select: { settings: true },
    }),
    prisma.calendarConnection.findMany({
      where: { emailAccountId },
      select: { email: true },
    }),
  ]);
  const preferences = resolveCalendarPreferences(stored?.settings);
  const own = new Set(ownEmails.map(({ email }) => email.toLowerCase()));
  const guests = [
    ...new Set(attendee.filter((email) => !own.has(email.toLowerCase()))),
  ];

  const [ownBusy, guestAvailability] = await Promise.all([
    loadOwnBusy({ emailAccountId, from, to, timeZone: timezone }),
    loadGuestAvailability({ emailAccountId, emails: guests, from, to, logger }),
  ]);

  const busyByPerson: Record<string, (typeof ownBusy)[number][]> = {
    self: ownBusy,
  };
  const people: { email: string; status: "known" | "unknown" }[] = [];
  for (const email of guests) {
    const availability = guestAvailability[email];
    if (availability?.status === "known") {
      busyByPerson[email] = availability.busy;
      people.push({ email, status: "known" });
    } else {
      people.push({ email, status: "unknown" });
    }
  }

  const slots = findFreeSlots({
    busyByPerson,
    window: { start: from, end: to },
    durationMinutes,
    schedule: preferences,
    timeZone: timezone,
    limit,
    includeOutsideWorkingHours,
  });

  return {
    slots: slots.map((slot) => ({
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
      backToBack: slot.backToBack,
    })),
    people,
  };
}
