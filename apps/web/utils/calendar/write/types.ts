/**
 * Calendar writes: design note
 *
 * Local-first. The calendar screen reads CalendarEvent rows, not the
 * provider. A write therefore changes the row first, so the screen is right
 * immediately, then calls the provider, then replaces the row with what the
 * provider answered (etag, updated, iCalUID, htmlLink, Meet link). The sync
 * remains the only other writer of those rows.
 *
 * - Rows are addressed by (calendarId, providerEventId), never by row id: the
 *   sync replaces rows page by page, so row ids are not stable.
 * - Create generates the provider event id on our side (Google accepts
 *   client-chosen ids). The optimistic row therefore already has its final
 *   key, and a sync that sees the event before we reconcile rewrites that same
 *   row instead of adding a second one. A retry of a create that timed out gets
 *   a 409 instead of a duplicate.
 * - Update and move are patches guarded by If-Match with the stored etag. A
 *   412 means the event changed upstream since the last sync: the row is
 *   replaced with the fresh provider copy and the caller reports
 *   "event changed" so the user decides again. Nothing is overwritten.
 * - Any other failure restores the row from the snapshot taken before the
 *   optimistic change (or deletes the row for a create), so a failed write
 *   never leaves a phantom state. A cancelled delete restores the row.
 * - RSVP does not use If-Match: it only touches the viewer's own response and
 *   the answer is merged into the stored attendee list rather than replacing it.
 * - Every provider call goes through withCalendarSyncBudget. A rate limit
 *   becomes a typed "paused" result with retryAfterMs; nothing retries
 *   automatically. If the budget cannot be consulted the write is refused
 *   (fail closed), same as the sync.
 * - Recurring events (a series master, or an exception) are read-only in this
 *   phase; the server action refuses them.
 * - Microsoft returns "unsupported" for every write.
 * - Delete undo is a re-create from the snapshot the client kept. It gets a
 *   new provider id; invitations are sent again only if there were guests.
 */

import type { EventRowData } from "@/utils/calendar/sync/types";

export type EventTiming =
  | { isAllDay: false; start: Date; end: Date; timeZone: string }
  /** Floating dates, `YYYY-MM-DD`; `endDate` is exclusive. */
  | { isAllDay: true; startDate: string; endDate: string };

export type ResponseStatus =
  | "needsAction"
  | "accepted"
  | "declined"
  | "tentative";

/** The answers the viewer can give. */
export type RsvpResponse = Exclude<ResponseStatus, "needsAction">;

export type EventGuest = {
  email: string;
  name?: string;
  /** Kept for guests already on the event so a patch does not reset them. */
  responseStatus?: ResponseStatus;
};

export type EventReminders =
  | { useDefault: true }
  | {
      useDefault: false;
      overrides: Array<{ method: "popup" | "email"; minutes: number }>;
    };

/** Whom the provider notifies about the change. */
export type SendUpdates = "all" | "externalOnly" | "none";

type EventTarget = {
  /** Provider calendar id (Calendar.calendarId), not the database id. */
  providerCalendarId: string;
  providerEventId: string;
};

export type CreateEventInput = {
  providerCalendarId: string;
  /** Chosen by the caller so the optimistic row can use the final key. */
  providerEventId: string;
  title: string;
  description?: string;
  location?: string;
  timing: EventTiming;
  guests: EventGuest[];
  reminders?: EventReminders;
  addVideoConference?: boolean;
  sendUpdates: SendUpdates;
};

export type UpdateEventInput = EventTarget & {
  /** Stored etag; the provider refuses the patch if the event moved on. */
  etag: string | null;
  patch: {
    title?: string;
    /** Empty string clears. */
    description?: string;
    location?: string;
    timing?: EventTiming;
    guests?: EventGuest[];
    reminders?: EventReminders;
    addVideoConference?: boolean;
  };
  sendUpdates: SendUpdates;
};

export type MoveEventInput = EventTarget & {
  etag: string | null;
  current: EventTiming;
  /** New start instant for a timed event, `YYYY-MM-DD` for an all-day one. */
  newStart: Date | string;
  sendUpdates: SendUpdates;
};

export type DeleteEventInput = EventTarget & {
  sendUpdates: SendUpdates;
};

export type RespondToEventInput = EventTarget & {
  /** The viewer's address on the event. */
  selfEmail: string;
  response: RsvpResponse;
  sendUpdates: SendUpdates;
};

export type SetRemindersInput = EventTarget & {
  etag: string | null;
  reminders: EventReminders;
};

export type WriteFailureReason =
  | "unsupported"
  | "conflict"
  | "not_found"
  | "forbidden"
  | "needs_reconnect"
  | "paused"
  | "invalid"
  | "failed";

export type WriteFailure = {
  ok: false;
  reason: WriteFailureReason;
  /** Short, safe to show to the user. */
  message: string;
  /** Present when reason is "paused". */
  retryAfterMs?: number;
};

export type WriteResult<T> = { ok: true; value: T } | WriteFailure;

export interface CalendarEventWriter {
  createEvent(input: CreateEventInput): Promise<WriteResult<EventRowData>>;
  /** A delete of an event the provider no longer has counts as done. */
  deleteEvent(input: DeleteEventInput): Promise<WriteResult<null>>;
  /** Current provider copy; used to recover after a conflict. */
  fetchEvent(input: EventTarget): Promise<WriteResult<EventRowData>>;
  moveEvent(input: MoveEventInput): Promise<WriteResult<EventRowData>>;
  respondToEvent(
    input: RespondToEventInput,
  ): Promise<WriteResult<EventRowData>>;
  setReminders(input: SetRemindersInput): Promise<WriteResult<EventRowData>>;
  updateEvent(input: UpdateEventInput): Promise<WriteResult<EventRowData>>;
}
