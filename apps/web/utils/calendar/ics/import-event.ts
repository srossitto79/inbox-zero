import type { EditorState } from "@/utils/calendar/event-editor-state";
import type { ParsedIcsEvent } from "@/utils/calendar/ics/parse-ics";
import {
  addDaysToDateKey,
  toDateKey,
  toWallClock,
} from "@/utils/calendar/zoned-time";

// The create action validates these caps; an import keeps to them instead of
// rejecting the whole event.
const MAX_IMPORT_GUESTS = 200;
const MAX_IMPORT_REMINDERS = 5;
const MAX_TITLE = 1024;
const MAX_LOCATION = 1024;
const MAX_DESCRIPTION = 8192;

/**
 * Maps one parsed ICS event onto the editor's shape so an import runs through
 * the same single-event create path as manual entry. Recurrence lines are
 * dropped: the write layer creates one event, not a series.
 */
export function parsedIcsToEditorState({
  event,
  calendarId,
  viewerTimeZone,
}: {
  event: ParsedIcsEvent;
  calendarId: string;
  viewerTimeZone: string;
}): EditorState {
  const organizerEmail = event.organizer?.email.toLowerCase() ?? null;
  // Kept inside the provider's caps so one crowded event does not reject the write.
  const guests = unique(
    event.attendees
      .map((attendee) => attendee.email)
      .filter((email) => email.toLowerCase() !== organizerEmail),
  ).slice(0, MAX_IMPORT_GUESTS);

  const base = {
    title: truncate(event.title, MAX_TITLE),
    calendarId,
    guests,
    sendInvitations: guests.length > 0,
    addVideoConference: false,
    location: truncate(event.location ?? "", MAX_LOCATION),
    description: truncate(event.description ?? "", MAX_DESCRIPTION),
    reminders: {
      useDefault: event.reminders.length === 0,
      overrides: event.reminders
        .slice(0, MAX_IMPORT_REMINDERS)
        .map((minutes) => ({ method: "popup" as const, minutes })),
    },
  };

  if (event.isAllDay) {
    // All-day values carry UTC-midnight instants with an exclusive end.
    const startDate = toDateKey(event.start, "UTC");
    const endDate = addDaysToDateKey(toDateKey(event.end, "UTC"), -1);
    return {
      ...base,
      isAllDay: true,
      startDate,
      endDate: endDate >= startDate ? endDate : startDate,
      startTime: "09:00",
      endTime: "10:00",
      timeZone: viewerTimeZone,
    };
  }

  const timeZone = event.timeZone ?? viewerTimeZone;
  const start = toWallClock(event.start, timeZone);
  const end = toWallClock(event.end, timeZone);
  return {
    ...base,
    isAllDay: false,
    startDate: toDateKey(event.start, timeZone),
    startTime: clock(start.hour, start.minute),
    endDate: toDateKey(event.end, timeZone),
    endTime: clock(end.hour, end.minute),
    timeZone,
  };
}

function clock(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value;
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((email) => {
    const key = email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
