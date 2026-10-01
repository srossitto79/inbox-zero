import { isInvalidGrantError, SafeError } from "@/utils/error";
import { extractErrorInfo as extractGoogleErrorInfo } from "@/utils/gmail/retry";
import { extractErrorInfo as extractMicrosoftErrorInfo } from "@/utils/microsoft/retry";

export type CalendarSyncFailure = "needs_reconnect" | "not_found" | "other";

const INSUFFICIENT_SCOPE_REASONS = [
  "insufficientPermissions",
  "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
];

/**
 * Separates failures the user fixes by reconnecting from transient ones.
 * Rate limits are handled before this, by the sync budget.
 */
export function classifyCalendarSyncError(error: unknown): CalendarSyncFailure {
  if (isInvalidGrantError(error)) return "needs_reconnect";
  if (
    error instanceof SafeError &&
    /reconnect|no refresh token/i.test(error.message)
  ) {
    return "needs_reconnect";
  }

  const google = extractGoogleErrorInfo(error);
  const microsoft = extractMicrosoftErrorInfo(error);
  const status = google.status ?? microsoft.status;

  if (status === 401) return "needs_reconnect";
  if (
    status === 403 &&
    (INSUFFICIENT_SCOPE_REASONS.includes(String(google.reason)) ||
      /insufficient|access.?denied/i.test(
        `${google.errorMessage} ${microsoft.code ?? ""}`,
      ))
  ) {
    return "needs_reconnect";
  }
  if (status === 404) return "not_found";
  return "other";
}
