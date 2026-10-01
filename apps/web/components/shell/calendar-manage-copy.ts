import type { ManageCalendarResult } from "@/utils/calendar/manage/manage-calendar";

type Failure = Exclude<ManageCalendarResult, { status: "ok" }>;

const MESSAGES: Record<Exclude<Failure["status"], "paused">, string> = {
  reconnect_required: "Reconnect Google Calendar to continue.",
  unsupported: "Not available for Outlook calendars.",
  not_found: "Calendar not found.",
  primary_protected: "The primary calendar cannot be changed.",
  read_only: "No permission to change this calendar.",
};

/** User-facing text for a refused calendar change, or null when it succeeded. */
export function describeManageFailure(
  result: ManageCalendarResult | undefined,
): string | null {
  if (!result || result.status === "ok") return null;
  if (result.status === "paused") {
    const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    return `Google Calendar is busy. Try again in ${seconds} s.`;
  }
  return MESSAGES[result.status];
}
