import { NextResponse } from "next/server";
import { withEmailAccount } from "@/utils/middleware";
import prisma from "@/utils/prisma";
import { resolveCalendarPreferences } from "@/utils/calendar/preferences/preferences";

export type GetCalendarPreferencesResponse = Awaited<
  ReturnType<typeof getData>
>;

export const GET = withEmailAccount(
  "user/calendar/preferences",
  async (request) => {
    const result = await getData({
      emailAccountId: request.auth.emailAccountId,
    });
    return NextResponse.json(result);
  },
);

async function getData({ emailAccountId }: { emailAccountId: string }) {
  const stored = await prisma.calendarPreference.findUnique({
    where: { emailAccountId },
    select: { settings: true },
  });
  return { preferences: resolveCalendarPreferences(stored?.settings) };
}
