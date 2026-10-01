import type { calendar_v3 } from "@googleapis/calendar";
import prisma from "@/utils/prisma";

type ProviderCalendar = {
  calendarId: string;
  name: string;
  description: string | null;
  timezone: string | null;
  primary: boolean;
  color: string | null;
  canEdit: boolean;
};

export function mapGoogleCalendar(
  calendar: calendar_v3.Schema$CalendarListEntry,
): ProviderCalendar | null {
  if (!calendar.id) return null;
  return {
    calendarId: calendar.id,
    name: calendar.summary || "Untitled Calendar",
    description: calendar.description ?? null,
    timezone: calendar.timeZone ?? null,
    primary: calendar.primary ?? false,
    color: calendar.backgroundColor ?? null,
    canEdit:
      calendar.accessRole === "owner" || calendar.accessRole === "writer",
  };
}

export function mapMicrosoftCalendar(calendar: {
  id?: string;
  name?: string;
  description?: string;
  isDefaultCalendar?: boolean;
  hexColor?: string;
  canEdit?: boolean;
}): ProviderCalendar | null {
  if (!calendar.id) return null;
  return {
    calendarId: calendar.id,
    name: calendar.name || "Untitled Calendar",
    description: calendar.description ?? null,
    timezone: null,
    primary: calendar.isDefaultCalendar ?? false,
    color: calendar.hexColor || null,
    canEdit: calendar.canEdit ?? false,
  };
}

/**
 * Names, colors and write access follow the provider; `isEnabled` is the
 * user's choice and is only set when a calendar first appears.
 */
export async function saveProviderCalendars({
  connectionId,
  calendars,
}: {
  connectionId: string;
  calendars: ProviderCalendar[];
}) {
  for (const calendar of calendars) {
    const { calendarId, ...fields } = calendar;
    await prisma.calendar.upsert({
      where: { connectionId_calendarId: { connectionId, calendarId } },
      update: fields,
      create: { connectionId, calendarId, ...fields, isEnabled: true },
    });
  }
  await prisma.calendarConnection.update({
    where: { id: connectionId },
    data: { calendarListSyncedAt: new Date() },
  });
}
