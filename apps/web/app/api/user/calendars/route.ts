import { NextResponse } from "next/server";
import { getCalendarConnectionState } from "@/utils/calendar/connection-scopes";
import prisma from "@/utils/prisma";
import { withEmailAccount } from "@/utils/middleware";

export type GetCalendarsResponse = Awaited<ReturnType<typeof getData>>;

export const GET = withEmailAccount("user/calendars", async (request) => {
  const { emailAccountId } = request.auth;

  const result = await getData({ emailAccountId });
  return NextResponse.json(result);
});

async function getData({ emailAccountId }: { emailAccountId: string }) {
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      timezone: true,
      calendarBookingLink: true,
      calendarConnections: {
        select: {
          id: true,
          email: true,
          provider: true,
          isConnected: true,
          scope: true,
          calendars: {
            select: {
              id: true,
              name: true,
              isEnabled: true,
              primary: true,
              description: true,
              timezone: true,
              color: true,
              canEdit: true,
              syncStatus: true,
              lastSyncedAt: true,
              syncRetryAt: true,
              syncError: true,
            },
            orderBy: {
              name: "asc",
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  const connections = (emailAccount?.calendarConnections || []).map(
    ({ scope, ...connection }) => ({
      ...connection,
      state: getCalendarConnectionState({ ...connection, scope }),
    }),
  );

  return {
    connections,
    timezone: emailAccount?.timezone || null,
    calendarBookingLink: emailAccount?.calendarBookingLink || null,
  };
}
