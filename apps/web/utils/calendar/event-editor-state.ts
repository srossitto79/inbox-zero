import type { CalendarViewEvent } from "@/utils/calendar/expand-events";
import {
  addDaysToDateKey,
  diffDateKeys,
  formatDateKey,
  isValidTimeZone,
  parseDateKey,
  toWallClock,
  wallClockToInstant,
} from "@/utils/calendar/zoned-time";

export type EditorReminders = {
  useDefault: boolean;
  overrides: Array<{ method: "popup" | "email"; minutes: number }>;
};

/**
 * What the event editor edits. Dates are `YYYY-MM-DD` and times `HH:mm` in
 * `timeZone`; an all-day event ends on its last day (inclusive), which is how
 * people read it, and is converted to the exclusive end the providers use.
 */
export type EditorState = {
  title: string;
  calendarId: string;
  isAllDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timeZone: string;
  location: string;
  description: string;
  /** Guest emails the editor can change; the viewer and organizer are implicit. */
  guests: string[];
  sendInvitations: boolean;
  addVideoConference: boolean;
  reminders: EditorReminders;
};

type Timing =
  | { isAllDay: false; start: string; end: string; timeZone: string }
  | { isAllDay: true; startDate: string; endDate: string };

const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export function createEditorState({
  calendarId,
  timeZone,
  range,
}: {
  calendarId: string;
  timeZone: string;
  range: { start: Date; end: Date } | { startDate: string; endDate: string };
}): EditorState {
  const base = {
    title: "",
    calendarId,
    timeZone,
    location: "",
    description: "",
    guests: [],
    sendInvitations: true,
    addVideoConference: false,
    reminders: { useDefault: true, overrides: [] },
  };
  if ("startDate" in range) {
    return {
      ...base,
      isAllDay: true,
      startDate: range.startDate,
      startTime: "09:00",
      endDate: range.endDate,
      endTime: "10:00",
    };
  }
  const start = toDateAndTime(range.start, timeZone);
  const end = toDateAndTime(range.end, timeZone);
  return {
    ...base,
    isAllDay: false,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
  };
}

export function eventToEditorState(
  event: CalendarViewEvent,
  viewerTimeZone: string,
): EditorState {
  const timeZone = isValidTimeZone(event.timezone)
    ? (event.timezone as string)
    : viewerTimeZone;
  const guests = event.attendees
    .filter((attendee) => !attendee.isSelf && !attendee.isOrganizer)
    .map((attendee) => attendee.email);
  const common = {
    title: event.title,
    calendarId: event.calendarId,
    timeZone,
    location: event.location ?? "",
    description: event.description ?? "",
    guests,
    sendInvitations: true,
    addVideoConference: false,
    reminders: event.reminders
      ? {
          useDefault: event.reminders.useDefault,
          overrides: event.reminders.overrides.flatMap((override) =>
            override.method === "popup" || override.method === "email"
              ? [{ method: override.method, minutes: override.minutes }]
              : [],
          ),
        }
      : { useDefault: true, overrides: [] },
  };

  if (event.isAllDay) {
    return {
      ...common,
      isAllDay: true,
      startDate: event.start,
      startTime: "09:00",
      endDate: addDaysToDateKey(event.end, -1),
      endTime: "10:00",
    };
  }
  const start = toDateAndTime(new Date(event.start), timeZone);
  const end = toDateAndTime(new Date(event.end), timeZone);
  return {
    ...common,
    isAllDay: false,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
  };
}

/** A user-facing problem that blocks saving, or null. */
export function getEditorProblem(state: EditorState): string | null {
  if (state.guests.some((email) => !EMAIL_PATTERN.test(email))) {
    return "Invalid email";
  }
  if (!state.isAllDay && !isValidTimeZone(state.timeZone)) {
    return "Invalid time zone";
  }
  if (
    !isDateKey(state.startDate) ||
    !isDateKey(state.endDate) ||
    (!state.isAllDay && !(isTime(state.startTime) && isTime(state.endTime)))
  ) {
    return "Invalid date";
  }
  if (state.isAllDay) {
    return state.endDate >= state.startDate ? null : "End must be after start";
  }
  const timing = editorStateToTiming(state);
  return new Date(timing.isAllDay ? 0 : timing.end) >
    new Date(timing.isAllDay ? 0 : timing.start)
    ? null
    : "End must be after start";
}

export function editorStateToTiming(state: EditorState): Timing {
  if (state.isAllDay) {
    return {
      isAllDay: true,
      startDate: state.startDate,
      endDate: addDaysToDateKey(state.endDate, 1),
    };
  }
  return {
    isAllDay: false,
    start: toInstant(state.startDate, state.startTime, state.timeZone),
    end: toInstant(state.endDate, state.endTime, state.timeZone),
    timeZone: state.timeZone,
  };
}

export function editorStateToCreatePayload(state: EditorState) {
  const guests = state.guests.map((email) => ({ email }));
  return {
    calendarId: state.calendarId,
    title: state.title.trim(),
    description: state.description,
    location: state.location.trim(),
    timing: editorStateToTiming(state),
    guests,
    reminders: state.reminders,
    addVideoConference: state.addVideoConference,
    sendUpdates:
      guests.length > 0 && state.sendInvitations
        ? ("all" as const)
        : ("none" as const),
  };
}

/**
 * Only what changed, so an untouched field is never rewritten (an event in the
 * repeated hour of a DST change keeps its time when only the title is edited).
 * Returns null when nothing changed.
 */
export function editorStateToUpdatePayload({
  initial,
  current,
  providerEventId,
}: {
  initial: EditorState;
  current: EditorState;
  providerEventId: string;
}) {
  const changes: {
    title?: string;
    description?: string;
    location?: string;
    timing?: Timing;
    guests?: Array<{ email: string }>;
    reminders?: EditorReminders;
    addVideoConference?: boolean;
  } = {};

  if (current.title.trim() !== initial.title.trim()) {
    changes.title = current.title.trim();
  }
  if (current.description !== initial.description) {
    changes.description = current.description;
  }
  if (current.location.trim() !== initial.location.trim()) {
    changes.location = current.location.trim();
  }
  if (isTimingChanged(initial, current)) {
    changes.timing = editorStateToTiming(current);
  }
  if (!sameEmails(initial.guests, current.guests)) {
    changes.guests = current.guests.map((email) => ({ email }));
  }
  if (JSON.stringify(initial.reminders) !== JSON.stringify(current.reminders)) {
    changes.reminders = current.reminders;
  }
  if (current.addVideoConference && !initial.addVideoConference) {
    changes.addVideoConference = true;
  }
  if (Object.keys(changes).length === 0) return null;

  const involvesGuests = current.guests.length > 0 || initial.guests.length > 0;
  return {
    calendarId: current.calendarId,
    providerEventId,
    ...changes,
    sendUpdates:
      involvesGuests && current.sendInvitations
        ? ("all" as const)
        : ("none" as const),
  };
}

/**
 * Changes the start and moves the end with it, so the length stays. Editing
 * the end alone never touches the start.
 */
export function withStart(
  state: EditorState,
  change: { startDate?: string; startTime?: string },
): EditorState {
  const next = { ...state, ...change };
  if (state.isAllDay) {
    if (!change.startDate || !isDateKey(change.startDate)) return next;
    if (!isDateKey(state.startDate) || !isDateKey(state.endDate)) return next;
    const days = diffDateKeys(state.startDate, state.endDate);
    return { ...next, endDate: addDaysToDateKey(change.startDate, days) };
  }
  if (
    !isDateKey(next.startDate) ||
    !isTime(next.startTime) ||
    !isDateKey(state.startDate) ||
    !isDateKey(state.endDate) ||
    !isTime(state.startTime) ||
    !isTime(state.endTime)
  ) {
    return next;
  }
  const previousStart = new Date(
    toInstant(state.startDate, state.startTime, state.timeZone),
  );
  const previousEnd = new Date(
    toInstant(state.endDate, state.endTime, state.timeZone),
  );
  const length = previousEnd.getTime() - previousStart.getTime();
  if (length <= 0) return next;
  const end = toDateAndTime(
    new Date(
      new Date(
        toInstant(next.startDate, next.startTime, state.timeZone),
      ).getTime() + length,
    ),
    state.timeZone,
  );
  return { ...next, endDate: end.date, endTime: end.time };
}

/** Splits pasted or typed text into valid and invalid email addresses. */
export function parseGuestInput(text: string) {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const token = part.trim().replace(/^<|>$/g, "");
    if (!token) continue;
    (EMAIL_PATTERN.test(token) ? valid : invalid).push(token);
  }
  return { valid, invalid };
}

export function addGuests(existing: string[], additions: string[]) {
  const seen = new Set(existing.map((email) => email.toLowerCase()));
  const result = [...existing];
  for (const email of additions) {
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    result.push(email);
  }
  return result;
}

function isTimingChanged(initial: EditorState, current: EditorState) {
  if (initial.isAllDay !== current.isAllDay) return true;
  if (initial.isAllDay) {
    return (
      initial.startDate !== current.startDate ||
      initial.endDate !== current.endDate
    );
  }
  return (
    initial.startDate !== current.startDate ||
    initial.startTime !== current.startTime ||
    initial.endDate !== current.endDate ||
    initial.endTime !== current.endTime ||
    initial.timeZone !== current.timeZone
  );
}

function sameEmails(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const set = new Set(a.map((email) => email.toLowerCase()));
  return b.every((email) => set.has(email.toLowerCase()));
}

function toDateAndTime(instant: Date, timeZone: string) {
  const wall = toWallClock(instant, timeZone);
  return {
    date: formatDateKey(wall.year, wall.month, wall.day),
    time: `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`,
  };
}

function toInstant(date: string, time: string, timeZone: string) {
  const { year, month, day } = parseDateKey(date);
  const [hour, minute] = time.split(":").map(Number);
  return wallClockToInstant(
    { year, month, day, hour, minute, second: 0 },
    timeZone,
  ).toISOString();
}

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
