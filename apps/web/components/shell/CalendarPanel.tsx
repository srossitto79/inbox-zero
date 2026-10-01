"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Switch } from "@/components/ui/switch";
import { useCalendars } from "@/hooks/useCalendars";
import { useAccount } from "@/providers/EmailAccountProvider";
import { toggleCalendarAction } from "@/utils/actions/calendar";
import {
  formatDateKey,
  parseDateKey,
  toDateKey,
} from "@/utils/calendar/zoned-time";
import { prefixPath } from "@/utils/path";

export function CalendarPanel() {
  const { emailAccountId } = useAccount();
  const { data, mutate } = useCalendars();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const { executeAsync } = useAction(
    toggleCalendarAction.bind(null, emailAccountId),
  );

  const selectedKey = searchParams.get("date") ?? toDateKey(new Date(), "UTC");
  const selected = useMemo(
    () => dateKeyToLocalNoon(selectedKey),
    [selectedKey],
  );
  const calendars =
    data?.connections.flatMap((connection) => connection.calendars) ?? [];

  const selectDate = (date: Date | undefined) => {
    if (!date) return;
    const next = new URLSearchParams(searchParams);
    next.set(
      "date",
      formatDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate()),
    );
    router.push(`${pathname}?${next}`);
  };

  const toggle = async (calendarId: string, isEnabled: boolean) => {
    if (!data) return;
    setPending(calendarId);
    const optimistic = {
      ...data,
      connections: data.connections.map((connection) => ({
        ...connection,
        calendars: connection.calendars.map((calendar) =>
          calendar.id === calendarId ? { ...calendar, isEnabled } : calendar,
        ),
      })),
    };
    await mutate(optimistic, false);
    const result = await executeAsync({ calendarId, isEnabled });
    if (result?.serverError || result?.validationErrors)
      await mutate(data, false);
    await mutate();
    setPending(null);
  };

  return (
    <div className="flex min-h-0 flex-col gap-5 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]">
      <Calendar
        mode="single"
        selected={selected}
        onSelect={selectDate}
        month={selected}
        onMonthChange={selectDate}
        className="-mx-1"
        classNames={{
          month: "space-y-2",
          caption_start: "px-1 pb-1",
          head_cell:
            "w-7 rounded-md text-[10px] font-medium text-muted-foreground",
          row: "mt-1 flex w-full",
          cell: "relative size-7 p-0 text-center text-xs focus-within:z-20",
          day: "size-7 rounded-md p-0 text-xs font-normal aria-selected:opacity-100",
        }}
      />

      <div>
        <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          My calendars
        </div>
        <div className="space-y-1">
          {calendars.map((calendar) => (
            <div
              key={calendar.id}
              className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm hover:bg-sidebar-accent"
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full bg-[var(--calendar-color)]"
                style={
                  {
                    "--calendar-color":
                      calendar.color ?? "hsl(var(--queue-calendar))",
                  } as React.CSSProperties
                }
              />
              <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
              <Switch
                size="sm"
                checked={calendar.isEnabled}
                disabled={pending === calendar.id}
                aria-label={`Show ${calendar.name}`}
                onCheckedChange={(checked) => toggle(calendar.id, checked)}
              />
            </div>
          ))}
          {data && calendars.length === 0 ? (
            <p className="px-1.5 text-sm text-muted-foreground">No calendars</p>
          ) : null}
          {!data ? (
            <p className="px-1.5 text-sm text-muted-foreground">Loading</p>
          ) : null}
        </div>
      </div>

      <Link
        href={prefixPath(emailAccountId, "/calendars")}
        className="rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
      >
        Calendar settings
      </Link>
    </div>
  );
}

function dateKeyToLocalNoon(dateKey: string) {
  try {
    const { year, month, day } = parseDateKey(dateKey);
    return new Date(year, month - 1, day, 12);
  } catch {
    return new Date();
  }
}
