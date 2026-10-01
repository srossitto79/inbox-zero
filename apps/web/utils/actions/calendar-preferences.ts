"use server";

import { actionClient } from "@/utils/actions/safe-action";
import { updateCalendarPreferencesBody } from "@/utils/actions/calendar-preferences.validation";
import { resolveCalendarPreferences } from "@/utils/calendar/preferences/preferences";
import prisma from "@/utils/prisma";

export const updateCalendarPreferencesAction = actionClient
  .metadata({ name: "updateCalendarPreferences" })
  .inputSchema(updateCalendarPreferencesBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput }) => {
    const existing = await prisma.calendarPreference.findUnique({
      where: { emailAccountId },
      select: { settings: true },
    });
    const preferences = resolveCalendarPreferences({
      ...resolveCalendarPreferences(existing?.settings),
      ...parsedInput,
    });

    await prisma.calendarPreference.upsert({
      where: { emailAccountId },
      create: { emailAccountId, settings: preferences },
      update: { settings: preferences },
    });

    return { preferences };
  });
