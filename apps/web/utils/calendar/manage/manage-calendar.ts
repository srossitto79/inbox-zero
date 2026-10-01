import type { calendar_v3 } from "@googleapis/calendar";
import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import {
  CalendarSyncPausedError,
  withCalendarSyncBudget,
} from "@/utils/calendar/calendar-sync-budget";
import { getCalendarClientWithRefresh } from "@/utils/calendar/client";
import { getCalendarConnectionState } from "@/utils/calendar/connection-scopes";
import { getForegroundColor } from "@/utils/calendar/manage/colors";
import { classifyCalendarSyncError } from "@/utils/calendar/sync/classify-sync-error";
import { extractErrorInfo } from "@/utils/gmail/retry";
import { isGoogleProvider } from "@/utils/email/provider-types";

const SCOPE_PREFIX = "https://www.googleapis.com/auth/";
const CALENDARS_SCOPE = "calendar.calendars";
const CALENDAR_LIST_SCOPE = "calendar.calendarlist";

export type ManageCalendarFailure =
  | { status: "unsupported" }
  | { status: "reconnect_required" }
  | { status: "not_found" }
  | { status: "primary_protected" }
  | { status: "read_only" }
  | { status: "paused"; retryAfterMs: number };

export type ManageCalendarResult<T extends object = object> =
  | ({ status: "ok" } & T)
  | ManageCalendarFailure;

type Connection = {
  id: string;
  provider: string;
  isConnected: boolean;
  scope: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
};

type CalendarContext = {
  emailAccountId: string;
  logger: Logger;
};

const connectionSelect = {
  id: true,
  provider: true,
  isConnected: true,
  scope: true,
  accessToken: true,
  refreshToken: true,
  expiresAt: true,
} as const;

/**
 * Creates a calendar at the provider, then stores it. The provider goes first
 * because it assigns the id; the local row is an upsert so a sync that already
 * listed the new calendar cannot produce a duplicate.
 */
export async function createCalendar({
  emailAccountId,
  logger,
  connectionId,
  name,
  description,
  timeZone,
  color,
}: CalendarContext & {
  connectionId: string;
  name: string;
  description?: string;
  timeZone?: string;
  color?: string;
}): Promise<ManageCalendarResult<{ calendar: { id: string; name: string } }>> {
  const connection = await prisma.calendarConnection.findFirst({
    where: { id: connectionId, emailAccountId },
    select: connectionSelect,
  });
  if (!connection) return { status: "not_found" };
  const blocked = gate(connection, [CALENDARS_SCOPE, CALENDAR_LIST_SCOPE]);
  if (blocked) return blocked;

  const inserted = await callGoogle({
    emailAccountId,
    logger,
    connection,
    run: async (client) => {
      const { data } = await client.calendars.insert({
        requestBody: {
          summary: name,
          description: description || undefined,
          timeZone,
        },
      });
      if (!data.id) throw new Error("Calendar was created without an id");
      return data;
    },
  });
  if (!inserted.ok) return inserted.failure;

  const created = inserted.value;
  const row = await prisma.calendar.upsert({
    where: {
      connectionId_calendarId: {
        connectionId: connection.id,
        calendarId: created.id as string,
      },
    },
    update: {
      name: created.summary ?? name,
      description: created.description ?? null,
      timezone: created.timeZone ?? timeZone ?? null,
      canEdit: true,
    },
    create: {
      connectionId: connection.id,
      calendarId: created.id as string,
      name: created.summary ?? name,
      description: created.description ?? null,
      timezone: created.timeZone ?? timeZone ?? null,
      primary: false,
      canEdit: true,
      isEnabled: true,
    },
    select: { id: true, name: true },
  });

  if (color) {
    // The calendar exists either way; a failed color leaves Google's default.
    const colored = await patchListColor({
      emailAccountId,
      logger,
      connection,
      providerCalendarId: created.id as string,
      color,
    });
    if (colored.ok) {
      await prisma.calendar.updateMany({
        where: { id: row.id },
        data: { color: colored.value },
      });
    } else {
      logger.warn("Could not set the color of a new calendar", {
        status: colored.failure.status,
      });
    }
  }

  return { status: "ok", calendar: row };
}

/**
 * Renames or edits a calendar. The local row changes first so the panel is
 * current immediately, then takes the provider's answer; a refusal restores it.
 */
export async function updateCalendar({
  emailAccountId,
  logger,
  calendarId,
  changes,
}: CalendarContext & {
  calendarId: string;
  changes: { name?: string; description?: string; timeZone?: string };
}): Promise<ManageCalendarResult> {
  const target = await loadTarget({ emailAccountId, calendarId });
  if (!target) return { status: "not_found" };
  const blocked = gate(target.connection, [CALENDARS_SCOPE]);
  if (blocked) return blocked;
  if (changes.name !== undefined && target.primary) {
    return { status: "primary_protected" };
  }
  if (!target.canEdit) return { status: "read_only" };

  const previous = {
    name: target.name,
    description: target.description,
    timezone: target.timezone,
  };
  await prisma.calendar.updateMany({
    where: { id: target.id },
    data: {
      ...(changes.name !== undefined && { name: changes.name }),
      ...(changes.description !== undefined && {
        description: changes.description || null,
      }),
      ...(changes.timeZone !== undefined && { timezone: changes.timeZone }),
    },
  });

  const patched = await callGoogle({
    emailAccountId,
    logger,
    connection: target.connection,
    run: async (client) => {
      const { data } = await client.calendars.patch({
        calendarId: target.calendarId,
        requestBody: {
          summary: changes.name,
          description: changes.description,
          timeZone: changes.timeZone,
        },
      });
      return data;
    },
  });

  if (!patched.ok) {
    await prisma.calendar.updateMany({
      where: { id: target.id },
      data: previous,
    });
    return patched.failure;
  }

  await prisma.calendar.updateMany({
    where: { id: target.id },
    data: {
      name: patched.value.summary ?? undefined,
      description: patched.value.description ?? null,
      timezone: patched.value.timeZone ?? undefined,
    },
  });
  return { status: "ok" };
}

/** Sets the color the user sees; it is a per-user setting of the calendar list. */
export async function setCalendarColor({
  emailAccountId,
  logger,
  calendarId,
  color,
}: CalendarContext & {
  calendarId: string;
  color: string;
}): Promise<ManageCalendarResult> {
  const target = await loadTarget({ emailAccountId, calendarId });
  if (!target) return { status: "not_found" };
  const blocked = gate(target.connection, [CALENDAR_LIST_SCOPE]);
  if (blocked) return blocked;

  await prisma.calendar.updateMany({
    where: { id: target.id },
    data: { color },
  });

  const colored = await patchListColor({
    emailAccountId,
    logger,
    connection: target.connection,
    providerCalendarId: target.calendarId,
    color,
  });
  if (!colored.ok) {
    await prisma.calendar.updateMany({
      where: { id: target.id },
      data: { color: target.color },
    });
    return colored.failure;
  }

  await prisma.calendar.updateMany({
    where: { id: target.id },
    data: { color: colored.value },
  });
  return { status: "ok" };
}

/**
 * Shows or hides calendars. Our own flag is the source of truth for what the
 * views load; the provider's `selected` flag follows when it can be written,
 * and a provider that cannot be reached does not undo the local change.
 */
export async function setCalendarsVisibility({
  emailAccountId,
  logger,
  changes,
}: CalendarContext & {
  changes: { calendarId: string; isEnabled: boolean }[];
}): Promise<ManageCalendarResult<{ providerSynced: boolean }>> {
  const ids = [...new Set(changes.map((change) => change.calendarId))];
  const calendars = await prisma.calendar.findMany({
    where: { id: { in: ids }, connection: { emailAccountId } },
    select: {
      id: true,
      calendarId: true,
      isEnabled: true,
      connection: { select: connectionSelect },
    },
  });
  if (calendars.length !== ids.length) return { status: "not_found" };

  const wanted = new Map(
    changes.map((change) => [change.calendarId, change.isEnabled]),
  );
  const changed = calendars.filter(
    (calendar) => wanted.get(calendar.id) !== calendar.isEnabled,
  );
  const toEnable = changed.filter((calendar) => wanted.get(calendar.id));
  const toDisable = changed.filter((calendar) => !wanted.get(calendar.id));
  await prisma.$transaction([
    prisma.calendar.updateMany({
      where: { id: { in: toEnable.map((calendar) => calendar.id) } },
      data: { isEnabled: true },
    }),
    prisma.calendar.updateMany({
      where: { id: { in: toDisable.map((calendar) => calendar.id) } },
      data: { isEnabled: false },
    }),
  ]);

  let providerSynced = true;
  for (const calendar of changed) {
    if (gate(calendar.connection, [CALENDAR_LIST_SCOPE])) {
      providerSynced = false;
      continue;
    }
    const selected = wanted.get(calendar.id) === true;
    const result = await callGoogle({
      emailAccountId,
      logger,
      connection: calendar.connection,
      run: (client) =>
        client.calendarList.patch({
          calendarId: calendar.calendarId,
          requestBody: { selected },
        }),
    });
    if (!result.ok) {
      providerSynced = false;
      // A pause or a revoked grant applies to every remaining call too.
      if (
        result.failure.status === "paused" ||
        result.failure.status === "reconnect_required"
      ) {
        break;
      }
    }
  }

  return { status: "ok", providerSynced };
}

/**
 * Deletes a calendar the user owns, or removes a subscribed one from their
 * list. The primary calendar is never touched. The local row goes only after
 * the provider confirmed (or reported the calendar already gone), so a refusal
 * leaves the calendar and its events in place.
 */
export async function deleteCalendar({
  emailAccountId,
  logger,
  calendarId,
}: CalendarContext & { calendarId: string }): Promise<
  ManageCalendarResult<{ removal: "deleted" | "unsubscribed" }>
> {
  const target = await loadTarget({ emailAccountId, calendarId });
  if (!target) return { status: "not_found" };
  if (target.primary) return { status: "primary_protected" };
  const blocked = gate(target.connection, [
    CALENDARS_SCOPE,
    CALENDAR_LIST_SCOPE,
  ]);
  if (blocked) return blocked;

  const removed = await callGoogle({
    emailAccountId,
    logger,
    connection: target.connection,
    cost: 2,
    run: async (client) => {
      const { data: entry } = await client.calendarList.get({
        calendarId: target.calendarId,
      });
      if (entry.primary) return "primary" as const;
      if (entry.accessRole === "owner") {
        await client.calendars.delete({ calendarId: target.calendarId });
        return "deleted" as const;
      }
      await client.calendarList.delete({ calendarId: target.calendarId });
      return "unsubscribed" as const;
    },
  });

  let removal: "deleted" | "unsubscribed";
  if (removed.ok) {
    if (removed.value === "primary") return { status: "primary_protected" };
    removal = removed.value;
  } else if (removed.failure.status === "not_found") {
    removal = "deleted";
  } else {
    return removed.failure;
  }

  await prisma.calendar.deleteMany({
    where: { id: target.id, connection: { emailAccountId } },
  });
  return { status: "ok", removal };
}

async function loadTarget({
  emailAccountId,
  calendarId,
}: {
  emailAccountId: string;
  calendarId: string;
}) {
  return prisma.calendar.findFirst({
    where: { id: calendarId, connection: { emailAccountId } },
    select: {
      id: true,
      calendarId: true,
      name: true,
      description: true,
      timezone: true,
      color: true,
      primary: true,
      canEdit: true,
      connection: { select: connectionSelect },
    },
  });
}

/** Why a connection cannot manage calendars, or null when it can. */
function gate(
  connection: Connection,
  requiredScopes: string[],
): ManageCalendarFailure | null {
  if (!isGoogleProvider(connection.provider)) return { status: "unsupported" };
  if (getCalendarConnectionState(connection) !== "connected") {
    return { status: "reconnect_required" };
  }
  const granted = new Set(
    (connection.scope ?? "").split(/[\s,]+/).filter(Boolean),
  );
  const hasScope = (scope: string) =>
    granted.has(`${SCOPE_PREFIX}${scope}`) ||
    granted.has(`${SCOPE_PREFIX}calendar`);
  return requiredScopes.every(hasScope)
    ? null
    : { status: "reconnect_required" };
}

async function patchListColor({
  emailAccountId,
  logger,
  connection,
  providerCalendarId,
  color,
}: CalendarContext & {
  connection: Connection;
  providerCalendarId: string;
  color: string;
}) {
  return callGoogle({
    emailAccountId,
    logger,
    connection,
    run: async (client) => {
      const { data } = await client.calendarList.patch({
        calendarId: providerCalendarId,
        colorRgbFormat: true,
        requestBody: {
          backgroundColor: color,
          foregroundColor: getForegroundColor(color),
        },
      });
      return data.backgroundColor ?? color;
    },
  });
}

type ProviderCall<T> =
  | { ok: true; value: T }
  | { ok: false; failure: ManageCalendarFailure };

/** Every Google call goes through the sync budget and maps known failures. */
async function callGoogle<T>({
  emailAccountId,
  logger,
  connection,
  run,
  cost = 1,
}: CalendarContext & {
  connection: Connection;
  run: (client: calendar_v3.Calendar) => Promise<T>;
  cost?: number;
}): Promise<ProviderCall<T>> {
  try {
    const client = await getCalendarClientWithRefresh({
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      expiresAt: connection.expiresAt?.getTime() ?? null,
      emailAccountId,
      connectionId: connection.id,
      logger,
    });
    const value = await withCalendarSyncBudget(
      { emailAccountId, provider: "google", cost },
      () => run(client),
    );
    return { ok: true, value };
  } catch (error) {
    if (error instanceof CalendarSyncPausedError) {
      return {
        ok: false,
        failure: { status: "paused", retryAfterMs: error.retryAfterMs },
      };
    }
    const kind = classifyCalendarSyncError(error);
    if (kind === "needs_reconnect") {
      return { ok: false, failure: { status: "reconnect_required" } };
    }
    const status = extractErrorInfo(error).status;
    if (kind === "not_found" || status === 410) {
      return { ok: false, failure: { status: "not_found" } };
    }
    if (status === 403) {
      return { ok: false, failure: { status: "read_only" } };
    }
    throw error;
  }
}
