"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useCalendarPreferences } from "@/hooks/useCalendarPreferences";
import { useFindATime } from "@/hooks/useFindATime";
import {
  formatClockTime,
  formatDuration,
} from "@/utils/calendar/preferences/format";
import { toDateKey } from "@/utils/calendar/zoned-time";

export type FindATimeSlot = { start: Date; end: Date };

type SearchDays = "7" | "14";

/**
 * Suggests meeting times that are free for the user and the attendees.
 * `onPick` receives the chosen slot; closing is left to the caller.
 */
export function FindATimeDialog({
  open,
  onOpenChange,
  attendees,
  durationMinutes,
  timeZone,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attendees: string[];
  durationMinutes: number;
  timeZone: string;
  onPick: (slot: FindATimeSlot) => void;
}) {
  const { preferences } = useCalendarPreferences();
  const [days, setDays] = useState<SearchDays>("7");
  // Fixed per opening so the request key stays stable while the dialog is open.
  const searchStart = useMemo(
    () => (open ? roundUpToHour(new Date()) : new Date(0)),
    [open],
  );
  const searchEnd = useMemo(
    () => new Date(searchStart.getTime() + Number(days) * 86_400_000),
    [searchStart, days],
  );

  const { data, error, isLoading } = useFindATime({
    attendees,
    from: searchStart,
    to: searchEnd,
    durationMinutes,
    timezone: timeZone,
    enabled: open,
  });

  const groups = useMemo(
    () => groupByDay(data?.slots ?? [], timeZone),
    [data, timeZone],
  );
  const unknown = data?.people.filter((person) => person.status === "unknown");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Find a time</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {formatDuration(durationMinutes)}
          </span>
          <SegmentedControl
            aria-label="Search range"
            value={days}
            onChange={setDays}
            options={[
              { value: "7", label: "7 days" },
              { value: "14", label: "14 days" },
            ]}
          />
        </div>

        {unknown?.length ? (
          <p className="text-sm text-muted-foreground">
            Availability unknown: {unknown.map((p) => p.email).join(", ")}
          </p>
        ) : null}

        <div className="max-h-80 space-y-4 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading</p>
          ) : null}
          {error ? (
            <p className="text-sm text-muted-foreground">
              Availability could not be loaded
            </p>
          ) : null}
          {data && groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No free times</p>
          ) : null}
          {groups.map((group) => (
            <div key={group.dateKey}>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                {group.label}
              </div>
              <div className="flex flex-wrap gap-2">
                {group.slots.map((slot) => (
                  <Button
                    key={slot.start.toISOString()}
                    variant="outline"
                    size="sm"
                    onClick={() => onPick(slot)}
                  >
                    {formatClockTime({
                      instant: slot.start,
                      timeZone,
                      timeFormat: preferences.timeFormat,
                    })}
                    {" - "}
                    {formatClockTime({
                      instant: slot.end,
                      timeZone,
                      timeFormat: preferences.timeFormat,
                    })}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function roundUpToHour(date: Date) {
  const hour = 3_600_000;
  return new Date(Math.ceil(date.getTime() / hour) * hour);
}

function groupByDay(slots: { start: string; end: string }[], timeZone: string) {
  const groups = new Map<
    string,
    { dateKey: string; label: string; slots: FindATimeSlot[] }
  >();
  for (const slot of slots) {
    const start = new Date(slot.start);
    const dateKey = toDateKey(start, timeZone);
    const group = groups.get(dateKey) ?? {
      dateKey,
      label: new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        timeZone,
      }).format(start),
      slots: [],
    };
    group.slots.push({ start, end: new Date(slot.end) });
    groups.set(dateKey, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
    .map((group) => ({
      ...group,
      slots: group.slots.sort((a, b) => a.start.getTime() - b.start.getTime()),
    }));
}
