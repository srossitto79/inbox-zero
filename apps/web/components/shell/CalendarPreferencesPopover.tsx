"use client";

import { useMemo } from "react";
import { SettingsIcon } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { toastError } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useCalendarPreferences } from "@/hooks/useCalendarPreferences";
import { useAccount } from "@/providers/EmailAccountProvider";
import { updateCalendarPreferencesAction } from "@/utils/actions/calendar-preferences";
import type { UpdateCalendarPreferencesBody } from "@/utils/actions/calendar-preferences.validation";
import { formatDuration } from "@/utils/calendar/preferences/format";
import { getWeekdayOrder } from "@/utils/calendar/preferences/week-range";
import { getActionErrorMessage } from "@/utils/error";
import { cn } from "@/utils";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DURATIONS = [15, 30, 45, 60, 90, 120];
const REMINDERS = [0, 5, 10, 15, 30, 60, 1440];
const NONE = "none";

export function CalendarPreferencesPopover() {
  const { emailAccountId } = useAccount();
  const { preferences, mutate } = useCalendarPreferences();
  const { executeAsync } = useAction(
    updateCalendarPreferencesAction.bind(null, emailAccountId),
  );
  const timeZones = useMemo(getTimeZones, []);

  const save = async (change: UpdateCalendarPreferencesBody) => {
    await mutate({ preferences: { ...preferences, ...change } }, false);
    const result = await executeAsync(change);
    if (result?.serverError || result?.validationErrors) {
      toastError({
        description: getActionErrorMessage(
          { serverError: result?.serverError },
          { prefix: "Could not save the settings" },
        ),
      });
    }
    await mutate();
  };

  const toggleDay = (day: number) => {
    const workingDays = preferences.workingDays.includes(day)
      ? preferences.workingDays.filter((value) => value !== day)
      : [...preferences.workingDays, day].sort();
    save({ workingDays });
  };

  const saveHours = (key: "start" | "end", value: string) => {
    if (!value) return;
    const next = { ...preferences.workingHours, [key]: value };
    if (next.end <= next.start) return;
    save({ workingHours: next });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Calendar settings"
        >
          <SettingsIcon className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-80 space-y-4">
        <Field label="Week starts on">
          <SegmentedControl
            aria-label="Week starts on"
            value={preferences.weekStart}
            onChange={(weekStart) => save({ weekStart })}
            options={[
              { value: "monday", label: "Mon" },
              { value: "sunday", label: "Sun" },
              { value: "saturday", label: "Sat" },
            ]}
          />
        </Field>

        <Field label="Working days">
          <div className="flex gap-1">
            {getWeekdayOrder(preferences.weekStart).map((day) => {
              const active = preferences.workingDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleDay(day)}
                  className={cn(
                    "h-7 flex-1 rounded-md text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {WEEKDAY_LABELS[day]}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Working hours">
          <div className="flex items-center gap-2">
            <Input
              type="time"
              aria-label="Start"
              defaultValue={preferences.workingHours.start}
              key={`start-${preferences.workingHours.start}`}
              onBlur={(event) => saveHours("start", event.target.value)}
            />
            <span className="text-muted-foreground">-</span>
            <Input
              type="time"
              aria-label="End"
              defaultValue={preferences.workingHours.end}
              key={`end-${preferences.workingHours.end}`}
              onBlur={(event) => saveHours("end", event.target.value)}
            />
          </div>
        </Field>

        <Field label="Time format">
          <SegmentedControl
            aria-label="Time format"
            value={preferences.timeFormat}
            onChange={(timeFormat) => save({ timeFormat })}
            options={[
              { value: "24h", label: "24-hour" },
              { value: "12h", label: "12-hour" },
            ]}
          />
        </Field>

        <Field label="Default view">
          <SegmentedControl
            aria-label="Default view"
            value={preferences.defaultView}
            onChange={(defaultView) => save({ defaultView })}
            options={[
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "agenda", label: "Agenda" },
            ]}
          />
        </Field>

        <Field label="Density">
          <SegmentedControl
            aria-label="Density"
            value={preferences.density}
            onChange={(density) => save({ density })}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </Field>

        <Field label="Secondary time zone">
          <Select
            value={preferences.secondaryTimeZone ?? NONE}
            onValueChange={(value) =>
              save({ secondaryTimeZone: value === NONE ? null : value })
            }
          >
            <SelectTrigger aria-label="Secondary time zone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value={NONE}>None</SelectItem>
              {timeZones.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Event length">
            <Select
              value={String(preferences.defaultDurationMinutes)}
              onValueChange={(value) =>
                save({ defaultDurationMinutes: Number(value) })
              }
            >
              <SelectTrigger aria-label="Event length">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATIONS.map((minutes) => (
                  <SelectItem key={minutes} value={String(minutes)}>
                    {formatDuration(minutes)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Reminder">
            <Select
              value={
                preferences.defaultReminderMinutes === null
                  ? NONE
                  : String(preferences.defaultReminderMinutes)
              }
              onValueChange={(value) =>
                save({
                  defaultReminderMinutes: value === NONE ? null : Number(value),
                })
              }
            >
              <SelectTrigger aria-label="Reminder">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {REMINDERS.map((minutes) => (
                  <SelectItem key={minutes} value={String(minutes)}>
                    {minutes === 0 ? "At start" : formatDuration(minutes)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </PopoverContent>
    </Popover>
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
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function getTimeZones() {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}
