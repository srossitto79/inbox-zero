import {
  CalendarSyncPausedError,
  withCalendarSyncBudget,
} from "@/utils/calendar/calendar-sync-budget";
import { classifyCalendarSyncError } from "@/utils/calendar/sync/classify-sync-error";
import type { WriteFailure, WriteResult } from "@/utils/calendar/write/types";
import { extractErrorInfo } from "@/utils/gmail/retry";
import type { Logger } from "@/utils/logger";

/**
 * Runs one provider write under the calendar budget and turns every failure
 * into a typed result. Rate limits pause instead of retrying.
 */
export async function runWriteCall<T>({
  emailAccountId,
  provider,
  logger,
  operation,
}: {
  emailAccountId: string;
  provider: "google" | "microsoft";
  logger: Logger;
  operation: () => Promise<T>;
}): Promise<WriteResult<T>> {
  try {
    const value = await withCalendarSyncBudget(
      { emailAccountId, provider },
      operation,
    );
    return { ok: true, value };
  } catch (error) {
    return classifyWriteError(error, logger);
  }
}

export function classifyWriteError(
  error: unknown,
  logger: Logger,
): WriteFailure {
  if (error instanceof CalendarSyncPausedError) {
    return {
      ok: false,
      reason: "paused",
      message: "Calendar is busy. Try again shortly.",
      retryAfterMs: error.retryAfterMs,
    };
  }

  const { status } = extractErrorInfo(error);
  if (status === 412) {
    return { ok: false, reason: "conflict", message: "Event changed" };
  }
  if (status === 409) {
    return { ok: false, reason: "conflict", message: "Event already exists" };
  }

  const failure = classifyCalendarSyncError(error);
  if (failure === "needs_reconnect") {
    return {
      ok: false,
      reason: "needs_reconnect",
      message: "Reconnect the calendar to edit events",
    };
  }
  if (failure === "not_found" || status === 410) {
    return { ok: false, reason: "not_found", message: "Event not found" };
  }
  if (status === 403) {
    return {
      ok: false,
      reason: "forbidden",
      message: "You cannot edit this event",
    };
  }
  if (status === 400) {
    return { ok: false, reason: "invalid", message: "Invalid event" };
  }

  logger.error("Calendar write failed", { error });
  return { ok: false, reason: "failed", message: "Could not save the event" };
}
