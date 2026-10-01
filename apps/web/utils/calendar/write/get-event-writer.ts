import { getCalendarClientWithRefresh } from "@/utils/calendar/client";
import { createGoogleEventWriter } from "@/utils/calendar/write/google-writer";
import { createMicrosoftEventWriter } from "@/utils/calendar/write/microsoft-writer";
import type { CalendarEventWriter } from "@/utils/calendar/write/types";
import type { Logger } from "@/utils/logger";

export function getCalendarEventWriter({
  connection,
  emailAccountId,
  calendarTimeZone,
  logger,
}: {
  connection: {
    id: string;
    provider: string;
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: Date | null;
  };
  emailAccountId: string;
  calendarTimeZone: string | null;
  logger: Logger;
}): CalendarEventWriter {
  if (connection.provider !== "google") return createMicrosoftEventWriter();

  return createGoogleEventWriter({
    emailAccountId,
    calendarTimeZone,
    logger,
    getClient: () =>
      getCalendarClientWithRefresh({
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        expiresAt: connection.expiresAt?.getTime() ?? null,
        emailAccountId,
        connectionId: connection.id,
        logger,
      }),
  });
}
