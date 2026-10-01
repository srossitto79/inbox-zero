"use client";

import { useMemo, useState } from "react";
import { ExternalLinkIcon, PlusIcon, TrashIcon, XIcon } from "lucide-react";
import type { GetCalendarEventsResponse } from "@/app/api/user/calendar/events/route";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  addGuests,
  type EditorState,
  getEditorProblem,
  parseGuestInput,
  withStart,
} from "@/utils/calendar/event-editor-state";
import { eventColor } from "./CalendarEventPopover";

type CalendarEvent = GetCalendarEventsResponse["events"][number];

export type EditorSession =
  | { kind: "create"; key: number; initial: EditorState }
  | {
      kind: "edit";
      key: number;
      event: CalendarEvent;
      initial: EditorState;
      /** Set when the event can be looked at but not changed. */
      readOnlyReason: string | null;
    };

export type WritableCalendar = {
  id: string;
  name: string;
  color: string | null;
};

const REMINDER_MINUTES = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10_080];

export function CalendarEventEditor({
  session,
  calendars,
  onClose,
  onSave,
  onDelete,
}: {
  session: EditorSession | null;
  calendars: WritableCalendar[];
  onClose: () => void;
  onSave: (session: EditorSession, state: EditorState) => Promise<boolean>;
  onDelete: (event: CalendarEvent) => void;
}) {
  return (
    <Dialog open={session !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        {session ? (
          <EditorForm
            key={session.key}
            session={session}
            calendars={calendars}
            onClose={onClose}
            onSave={onSave}
            onDelete={onDelete}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditorForm({
  session,
  calendars,
  onClose,
  onSave,
  onDelete,
}: {
  session: EditorSession;
  calendars: WritableCalendar[];
  onClose: () => void;
  onSave: (session: EditorSession, state: EditorState) => Promise<boolean>;
  onDelete: (event: CalendarEvent) => void;
}) {
  const [state, setState] = useState(session.initial);
  const [guestDraft, setGuestDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const event = session.kind === "edit" ? session.event : null;
  const readOnlyReason =
    session.kind === "edit" ? session.readOnlyReason : null;
  const readOnly = readOnlyReason !== null;
  const canEditGuests = !readOnly && (event === null || event.organizer.isSelf);
  const problem = getEditorProblem(state);
  const draftProblem =
    guestDraft.trim() && parseGuestInput(guestDraft).invalid.length > 0
      ? "Invalid email"
      : null;
  const timeZones = useMemo(
    () => getTimeZones(state.timeZone),
    [state.timeZone],
  );

  const patch = (changes: Partial<EditorState>) =>
    setState((current) => ({ ...current, ...changes }));

  const commitDraft = (current: EditorState) => {
    const { valid } = parseGuestInput(guestDraft);
    if (valid.length === 0) return current;
    return { ...current, guests: addGuests(current.guests, valid) };
  };

  const handleDraftChange = (value: string) => {
    if (/[,;\s]$/.test(value) && value.trim()) {
      const { valid, invalid } = parseGuestInput(value);
      if (valid.length > 0) {
        setState((current) => ({
          ...current,
          guests: addGuests(current.guests, valid),
        }));
        setGuestDraft(invalid.join(" "));
        return;
      }
    }
    setGuestDraft(value);
  };

  const submit = async () => {
    if (readOnly || saving || problem || draftProblem) return;
    const next = commitDraft(state);
    setState(next);
    setGuestDraft("");
    setSaving(true);
    const done = await onSave(session, next);
    setSaving(false);
    if (done) onClose();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        submit();
      }}
      onKeyDown={(keyEvent) => {
        if (
          keyEvent.key === "Enter" &&
          (keyEvent.metaKey || keyEvent.ctrlKey)
        ) {
          keyEvent.preventDefault();
          submit();
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {session.kind === "create" ? "New event" : "Event"}
        </DialogTitle>
      </DialogHeader>

      {readOnlyReason ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
          <span className="mr-auto">{readOnlyReason}</span>
          {event?.htmlLink ? (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
            >
              <ExternalLinkIcon className="size-3.5" />
              Open in Google Calendar
            </a>
          ) : null}
        </div>
      ) : null}

      <Input
        aria-label="Title"
        placeholder="Title"
        autoFocus={!readOnly}
        disabled={readOnly}
        value={state.title}
        onChange={(changeEvent) => patch({ title: changeEvent.target.value })}
      />

      <Field label="Calendar">
        <Select
          value={state.calendarId}
          disabled={readOnly || session.kind === "edit"}
          onValueChange={(calendarId) => patch({ calendarId })}
        >
          <SelectTrigger aria-label="Calendar">
            <SelectValue placeholder="Calendar" />
          </SelectTrigger>
          <SelectContent>
            {calendarOptions(calendars, event).map((calendar) => (
              <SelectItem key={calendar.id} value={calendar.id}>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full bg-[var(--calendar-color)]"
                    style={eventColor(calendar.color)}
                  />
                  {calendar.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="flex items-center gap-2">
        <Switch
          id="calendar-event-all-day"
          checked={state.isAllDay}
          disabled={readOnly}
          onCheckedChange={(isAllDay) => patch({ isAllDay })}
        />
        <Label htmlFor="calendar-event-all-day">All day</Label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Start">
          <div className="flex gap-2">
            <Input
              type="date"
              aria-label="Start date"
              disabled={readOnly}
              value={state.startDate}
              onChange={(changeEvent) =>
                setState((current) =>
                  withStart(current, { startDate: changeEvent.target.value }),
                )
              }
            />
            {state.isAllDay ? null : (
              <Input
                type="time"
                aria-label="Start time"
                disabled={readOnly}
                value={state.startTime}
                onChange={(changeEvent) =>
                  setState((current) =>
                    withStart(current, { startTime: changeEvent.target.value }),
                  )
                }
              />
            )}
          </div>
        </Field>
        <Field label="End">
          <div className="flex gap-2">
            <Input
              type="date"
              aria-label="End date"
              disabled={readOnly}
              value={state.endDate}
              onChange={(changeEvent) =>
                patch({ endDate: changeEvent.target.value })
              }
            />
            {state.isAllDay ? null : (
              <Input
                type="time"
                aria-label="End time"
                disabled={readOnly}
                value={state.endTime}
                onChange={(changeEvent) =>
                  patch({ endTime: changeEvent.target.value })
                }
              />
            )}
          </div>
        </Field>
      </div>

      {state.isAllDay ? null : (
        <Field label="Time zone">
          <Select
            value={state.timeZone}
            disabled={readOnly}
            onValueChange={(timeZone) => patch({ timeZone })}
          >
            <SelectTrigger aria-label="Time zone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {timeZones.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}

      <Field label="Location">
        <Input
          aria-label="Location"
          disabled={readOnly}
          value={state.location}
          onChange={(changeEvent) =>
            patch({ location: changeEvent.target.value })
          }
        />
      </Field>

      <Field label="Guests">
        <div className="space-y-2">
          {state.guests.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {state.guests.map((email) => (
                <li
                  key={email}
                  className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pl-2.5 pr-1 text-xs"
                >
                  {email}
                  {canEditGuests ? (
                    <button
                      type="button"
                      aria-label={`Remove ${email}`}
                      className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() =>
                        patch({
                          guests: state.guests.filter(
                            (guest) => guest !== email,
                          ),
                        })
                      }
                    >
                      <XIcon className="size-3" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {canEditGuests ? (
            <Input
              aria-label="Add guests"
              placeholder="Add guests"
              value={guestDraft}
              onChange={(changeEvent) =>
                handleDraftChange(changeEvent.target.value)
              }
              onKeyDown={(keyEvent) => {
                if (keyEvent.key !== "Enter") return;
                keyEvent.preventDefault();
                if (keyEvent.metaKey || keyEvent.ctrlKey) {
                  submit();
                  return;
                }
                handleDraftChange(`${guestDraft} `);
              }}
              onBlur={() => handleDraftChange(`${guestDraft} `)}
            />
          ) : null}
          {draftProblem ? (
            <p role="alert" className="text-sm text-destructive">
              {draftProblem}
            </p>
          ) : null}
          {canEditGuests && state.guests.length > 0 ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="calendar-event-invitations"
                checked={state.sendInvitations}
                onCheckedChange={(checked) =>
                  patch({ sendInvitations: checked === true })
                }
              />
              <Label htmlFor="calendar-event-invitations">
                Send invitations
              </Label>
            </div>
          ) : null}
        </div>
      </Field>

      {event?.videoLink ? (
        <a
          href={event.videoLink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
        >
          <ExternalLinkIcon className="size-3.5" />
          Join video
        </a>
      ) : readOnly ? null : (
        <div className="flex items-center gap-2">
          <Checkbox
            id="calendar-event-meet"
            checked={state.addVideoConference}
            onCheckedChange={(checked) =>
              patch({ addVideoConference: checked === true })
            }
          />
          <Label htmlFor="calendar-event-meet">Add Google Meet</Label>
        </div>
      )}

      <Field label="Reminders">
        <RemindersEditor
          reminders={state.reminders}
          disabled={readOnly}
          onChange={(reminders) => patch({ reminders })}
        />
      </Field>

      <Field label="Description">
        <Textarea
          aria-label="Description"
          rows={4}
          disabled={readOnly}
          value={state.description}
          onChange={(changeEvent) =>
            patch({ description: changeEvent.target.value })
          }
        />
      </Field>

      <DialogFooter className="gap-2 sm:items-center">
        {event && !readOnly ? (
          <Button
            type="button"
            variant="destructiveGhost"
            className="sm:mr-auto"
            Icon={TrashIcon}
            onClick={() => {
              onClose();
              onDelete(event);
            }}
          >
            Delete
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={onClose}>
          {readOnly ? "Close" : "Cancel"}
        </Button>
        {readOnly ? null : (
          <Button
            type="submit"
            loading={saving}
            disabled={Boolean(problem || draftProblem)}
          >
            Save
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}

function RemindersEditor({
  reminders,
  disabled,
  onChange,
}: {
  reminders: EditorState["reminders"];
  disabled: boolean;
  onChange: (reminders: EditorState["reminders"]) => void;
}) {
  const setOverrides = (overrides: EditorState["reminders"]["overrides"]) =>
    onChange({ useDefault: false, overrides });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Checkbox
          id="calendar-event-default-reminders"
          checked={reminders.useDefault}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({
              useDefault: checked === true,
              overrides: reminders.overrides,
            })
          }
        />
        <Label htmlFor="calendar-event-default-reminders">
          Calendar defaults
        </Label>
      </div>
      {reminders.useDefault
        ? null
        : reminders.overrides.map((reminder, index) => (
            <div
              // Reminders have no identity beyond their position.
              key={index}
              className="flex items-center gap-2"
            >
              <Select
                value={reminder.method}
                disabled={disabled}
                onValueChange={(method) =>
                  setOverrides(
                    reminders.overrides.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, method: method as "popup" | "email" }
                        : item,
                    ),
                  )
                }
              >
                <SelectTrigger aria-label="Reminder type" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="popup">Notification</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={String(reminder.minutes)}
                disabled={disabled}
                onValueChange={(minutes) =>
                  setOverrides(
                    reminders.overrides.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, minutes: Number(minutes) }
                        : item,
                    ),
                  )
                }
              >
                <SelectTrigger aria-label="Reminder time">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reminderOptions(reminder.minutes).map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {formatReminder(minutes)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {disabled ? null : (
                <Button
                  type="button"
                  variant="ghostMuted"
                  size="iconSm"
                  aria-label="Remove reminder"
                  onClick={() =>
                    setOverrides(
                      reminders.overrides.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    )
                  }
                >
                  <XIcon className="size-4" />
                </Button>
              )}
            </div>
          ))}
      {!reminders.useDefault && !disabled && reminders.overrides.length < 5 ? (
        <Button
          type="button"
          variant="ghostMuted"
          size="sm"
          Icon={PlusIcon}
          onClick={() =>
            setOverrides([
              ...reminders.overrides,
              { method: "popup", minutes: 10 },
            ])
          }
        >
          Add reminder
        </Button>
      ) : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function calendarOptions(
  calendars: WritableCalendar[],
  event: CalendarEvent | null,
) {
  // An event on a calendar that is no longer writable still needs its name.
  if (
    !event ||
    calendars.some((calendar) => calendar.id === event.calendarId)
  ) {
    return calendars;
  }
  return [
    ...calendars,
    {
      id: event.calendarId,
      name: event.calendarName,
      color: event.calendarColor,
    },
  ];
}

function reminderOptions(current: number) {
  return REMINDER_MINUTES.includes(current)
    ? REMINDER_MINUTES
    : [...REMINDER_MINUTES, current].sort((a, b) => a - b);
}

function formatReminder(minutes: number) {
  if (minutes === 0) return "At time of event";
  if (minutes % 10_080 === 0) {
    const weeks = minutes / 10_080;
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} before`;
  }
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} ${days === 1 ? "day" : "days"} before`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"} before`;
  }
  return `${minutes} minutes before`;
}

function getTimeZones(current: string) {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  const all = new Set(["UTC", ...zones, current]);
  return [...all].sort();
}
