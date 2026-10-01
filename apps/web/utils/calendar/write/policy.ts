import type { CalendarConnectionState } from "@/utils/calendar/connection-scopes";
import type {
  EventGuest,
  ResponseStatus,
  SendUpdates,
} from "@/utils/calendar/write/types";

export type WriteBlock =
  | "unsupported"
  | "reconnect"
  | "disconnected"
  | "read_only";

const WRITE_BLOCK_MESSAGES: Record<WriteBlock, string> = {
  unsupported: "Outlook events are read-only",
  reconnect: "Reconnect Google Calendar to edit events",
  disconnected: "Google Calendar is disconnected",
  read_only: "This calendar is read-only",
};

/**
 * Why a calendar cannot be written to, or null when it can. Shared by the
 * actions (which refuse) and the screen (which disables controls).
 */
export function getWriteBlock({
  provider,
  state,
  canEdit,
}: {
  provider: string;
  state: CalendarConnectionState;
  canEdit: boolean;
}): WriteBlock | null {
  if (provider !== "google") return "unsupported";
  if (state === "missing_scopes") return "reconnect";
  if (state === "disconnected") return "disconnected";
  if (!canEdit) return "read_only";
  return null;
}

export function getWriteBlockMessage(block: WriteBlock) {
  return WRITE_BLOCK_MESSAGES[block];
}

/**
 * Invitations go out when the caller says so, and otherwise whenever other
 * people are on the event.
 */
export function resolveSendUpdates({
  requested,
  hasOtherGuests,
}: {
  requested: SendUpdates | undefined;
  hasOtherGuests: boolean;
}): SendUpdates {
  return requested ?? (hasOtherGuests ? "all" : "none");
}

type StoredGuest = {
  email: string;
  name?: string;
  responseStatus?: string;
  isSelf?: boolean;
  isOrganizer?: boolean;
};

/**
 * The full attendee list to send with an edit. The viewer and the organizer
 * stay on the event whatever the editor shows, guests already invited keep
 * their answer, and guests missing from `incoming` are removed.
 */
export function composeGuests({
  stored,
  incoming,
}: {
  stored: StoredGuest[];
  incoming: Array<{ email: string; name?: string }>;
}): EventGuest[] {
  const byEmail = new Map(
    stored.map((guest) => [guest.email.toLowerCase(), guest]),
  );
  const result = new Map<string, EventGuest>();

  for (const guest of stored) {
    if (guest.isSelf || guest.isOrganizer) {
      result.set(guest.email.toLowerCase(), toEventGuest(guest));
    }
  }
  for (const guest of incoming) {
    const key = guest.email.trim().toLowerCase();
    if (result.has(key)) continue;
    const known = byEmail.get(key);
    result.set(
      key,
      known
        ? toEventGuest(known)
        : { email: guest.email.trim(), name: guest.name },
    );
  }
  return [...result.values()];
}

export function hasOtherGuests(guests: StoredGuest[]) {
  return guests.some((guest) => !guest.isSelf && !guest.isOrganizer);
}

function toEventGuest(guest: StoredGuest): EventGuest {
  return {
    email: guest.email,
    name: guest.name,
    responseStatus: isResponseStatus(guest.responseStatus)
      ? guest.responseStatus
      : undefined,
  };
}

function isResponseStatus(value: string | undefined): value is ResponseStatus {
  return (
    value === "needsAction" ||
    value === "accepted" ||
    value === "declined" ||
    value === "tentative"
  );
}
