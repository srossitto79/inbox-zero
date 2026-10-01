"use server";

import { actionClient } from "@/utils/actions/safe-action";
import {
  createCalendarBody,
  deleteCalendarBody,
  setCalendarColorBody,
  setCalendarsVisibilityBody,
  updateCalendarBody,
} from "@/utils/actions/calendar-manage.validation";
import {
  createCalendar,
  deleteCalendar,
  setCalendarColor,
  setCalendarsVisibility,
  updateCalendar,
} from "@/utils/calendar/manage/manage-calendar";

// The services return typed refusals (reconnect_required, unsupported, ...) as
// data so the panel can show the matching prompt instead of a generic error.

export const createCalendarAction = actionClient
  .metadata({ name: "createCalendar" })
  .inputSchema(createCalendarBody)
  .action(async ({ ctx: { emailAccountId, logger }, parsedInput }) =>
    createCalendar({ emailAccountId, logger, ...parsedInput }),
  );

export const updateCalendarAction = actionClient
  .metadata({ name: "updateCalendar" })
  .inputSchema(updateCalendarBody)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { calendarId, ...changes },
    }) => updateCalendar({ emailAccountId, logger, calendarId, changes }),
  );

export const setCalendarColorAction = actionClient
  .metadata({ name: "setCalendarColor" })
  .inputSchema(setCalendarColorBody)
  .action(async ({ ctx: { emailAccountId, logger }, parsedInput }) =>
    setCalendarColor({ emailAccountId, logger, ...parsedInput }),
  );

export const setCalendarsVisibilityAction = actionClient
  .metadata({ name: "setCalendarsVisibility" })
  .inputSchema(setCalendarsVisibilityBody)
  .action(async ({ ctx: { emailAccountId, logger }, parsedInput }) =>
    setCalendarsVisibility({ emailAccountId, logger, ...parsedInput }),
  );

export const deleteCalendarAction = actionClient
  .metadata({ name: "deleteCalendar" })
  .inputSchema(deleteCalendarBody)
  .action(async ({ ctx: { emailAccountId, logger }, parsedInput }) =>
    deleteCalendar({ emailAccountId, logger, ...parsedInput }),
  );
