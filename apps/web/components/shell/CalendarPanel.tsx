"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { ConnectCalendar } from "@/app/(app)/[emailAccountId]/calendars/ConnectCalendar";
import { toastError } from "@/components/Toast";
import { CalendarColorSwatches } from "@/components/shell/CalendarColorSwatches";
import { CalendarPreferencesPopover } from "@/components/shell/CalendarPreferencesPopover";
import { NewCalendarDialog } from "@/components/shell/NewCalendarDialog";
import { RenameCalendarDialog } from "@/components/shell/RenameCalendarDialog";
import { describeManageFailure } from "@/components/shell/calendar-manage-copy";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useCalendars } from "@/hooks/useCalendars";
import { useAccount } from "@/providers/EmailAccountProvider";
import {
  deleteCalendarAction,
  setCalendarColorAction,
  setCalendarsVisibilityAction,
} from "@/utils/actions/calendar-manage";
import {
  formatDateKey,
  parseDateKey,
  toDateKey,
} from "@/utils/calendar/zoned-time";
import { getActionErrorMessage } from "@/utils/error";
import { prefixPath } from "@/utils/path";
import type { GetCalendarsResponse } from "@/app/api/user/calendars/route";

type Connection = GetCalendarsResponse["connections"][number];
type PanelCalendar = Connection["calendars"][number] & {
  connection: Pick<Connection, "id" | "provider" | "state">;
};

export function CalendarPanel() {
  const { emailAccountId } = useAccount();
  const { data, mutate } = useCalendars();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<PanelCalendar | null>(null);
  const [deleting, setDeleting] = useState<PanelCalendar | null>(null);
  const visibility = useAction(
    setCalendarsVisibilityAction.bind(null, emailAccountId),
  );
  const color = useAction(setCalendarColorAction.bind(null, emailAccountId));
  const remove = useAction(deleteCalendarAction.bind(null, emailAccountId));

  const selectedKey = searchParams.get("date") ?? toDateKey(new Date(), "UTC");
  const selected = useMemo(
    () => dateKeyToLocalNoon(selectedKey),
    [selectedKey],
  );
  const calendars: PanelCalendar[] =
    data?.connections.flatMap((connection) =>
      connection.calendars.map((calendar) => ({ ...calendar, connection })),
    ) ?? [];
  const googleConnections =
    data?.connections.filter(
      (connection) => connection.provider === "google",
    ) ?? [];
  const writableConnection = googleConnections.find(
    (connection) => connection.state === "connected",
  );
  const needsReconnect = googleConnections.some(
    (connection) => connection.state === "missing_scopes",
  );

  const selectDate = (date: Date | undefined) => {
    if (!date) return;
    const next = new URLSearchParams(searchParams);
    next.set(
      "date",
      formatDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate()),
    );
    router.push(`${pathname}?${next}`);
  };

  // Applies a local change at once; the refetch afterwards replaces it with
  // whatever the server settled on, which also undoes a refused change.
  const change = async <T extends { data?: unknown; serverError?: string }>({
    id,
    optimistic,
    run,
    errorPrefix,
  }: {
    id: string;
    optimistic: (calendar: PanelCalendar) => PanelCalendar | null;
    run: () => Promise<T | undefined>;
    errorPrefix: string;
  }) => {
    if (!data) return;
    setPending(id);
    await mutate(applyToCalendars(data, optimistic), false);
    const result = await run();
    const failure = describeManageFailure(
      result?.data as Parameters<typeof describeManageFailure>[0],
    );
    if (!result || result.serverError || failure) {
      toastError({
        description:
          failure ??
          getActionErrorMessage(
            { serverError: result?.serverError },
            { prefix: errorPrefix },
          ),
      });
    }
    await mutate();
    setPending(null);
  };

  const setVisibility = (
    changes: { calendarId: string; isEnabled: boolean }[],
    id: string,
  ) => {
    if (changes.length === 0) return;
    const wanted = new Map(
      changes.map((item) => [item.calendarId, item.isEnabled]),
    );
    return change({
      id,
      optimistic: (calendar) =>
        wanted.has(calendar.id)
          ? { ...calendar, isEnabled: wanted.get(calendar.id) === true }
          : calendar,
      run: () => visibility.executeAsync({ changes }),
      errorPrefix: "Could not update the calendars",
    });
  };

  const toggle = (calendarId: string, isEnabled: boolean) =>
    setVisibility([{ calendarId, isEnabled }], calendarId);

  const showOnly = (calendarId: string) =>
    setVisibility(
      calendars.map((calendar) => ({
        calendarId: calendar.id,
        isEnabled: calendar.id === calendarId,
      })),
      calendarId,
    );

  const hideOthers = (calendarId: string) =>
    setVisibility(
      calendars
        .filter((calendar) => calendar.id !== calendarId && calendar.isEnabled)
        .map((calendar) => ({ calendarId: calendar.id, isEnabled: false })),
      calendarId,
    );

  const recolor = (calendarId: string, value: string) =>
    change({
      id: calendarId,
      optimistic: (calendar) =>
        calendar.id === calendarId ? { ...calendar, color: value } : calendar,
      run: () => color.executeAsync({ calendarId, color: value }),
      errorPrefix: "Could not change the color",
    });

  const confirmDelete = async () => {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    await change({
      id: target.id,
      optimistic: (calendar) => (calendar.id === target.id ? null : calendar),
      run: () => remove.executeAsync({ calendarId: target.id }),
      errorPrefix: "Could not delete the calendar",
    });
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
        <div className="mb-2 flex items-center justify-between px-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            My calendars
          </div>
          <div className="flex items-center gap-0.5">
            <CalendarPreferencesPopover />
            {writableConnection ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label="New calendar"
                onClick={() => setCreating(true)}
              >
                <PlusIcon className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </div>
        <div className="space-y-1">
          {calendars.map((calendar) => (
            <CalendarRow
              key={calendar.id}
              calendar={calendar}
              busy={pending === calendar.id}
              onToggle={(isEnabled) => toggle(calendar.id, isEnabled)}
              onRename={() => setRenaming(calendar)}
              onColor={(value) => recolor(calendar.id, value)}
              onShowOnly={() => showOnly(calendar.id)}
              onHideOthers={() => hideOthers(calendar.id)}
              onDelete={() => setDeleting(calendar)}
            />
          ))}
          {data && calendars.length === 0 ? (
            <p className="px-1.5 text-sm text-muted-foreground">No calendars</p>
          ) : null}
          {!data ? (
            <p className="px-1.5 text-sm text-muted-foreground">Loading</p>
          ) : null}
        </div>
      </div>

      {needsReconnect ? (
        <div className="space-y-2 px-1">
          <p className="text-sm text-muted-foreground">
            Reconnect Google Calendar to manage calendars.
          </p>
          <ConnectCalendar provider="google" reconnect />
        </div>
      ) : null}

      <Link
        href={prefixPath(emailAccountId, "/calendars")}
        className="rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
      >
        Calendar settings
      </Link>

      {writableConnection ? (
        <NewCalendarDialog
          open={creating}
          onOpenChange={setCreating}
          connectionId={writableConnection.id}
          onCreated={() => mutate()}
        />
      ) : null}
      <RenameCalendarDialog
        calendar={renaming}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        onRenamed={() => mutate()}
      />
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleting?.canEdit
                ? `Delete ${deleting.name}?`
                : `Remove ${deleting?.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.canEdit
                ? "The calendar and its events are deleted."
                : "The calendar is removed from your list."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {deleting?.canEdit ? "Delete" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CalendarRow({
  calendar,
  busy,
  onToggle,
  onRename,
  onColor,
  onShowOnly,
  onHideOthers,
  onDelete,
}: {
  calendar: PanelCalendar;
  busy: boolean;
  onToggle: (isEnabled: boolean) => void;
  onRename: () => void;
  onColor: (color: string) => void;
  onShowOnly: () => void;
  onHideOthers: () => void;
  onDelete: () => void;
}) {
  const isGoogle = calendar.connection.provider === "google";
  const canManage = isGoogle && calendar.connection.state === "connected";

  return (
    <div className="group flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm hover:bg-sidebar-accent">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full bg-[var(--calendar-color)]"
        style={
          {
            "--calendar-color": calendar.color ?? "hsl(var(--queue-calendar))",
          } as React.CSSProperties
        }
      />
      <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            aria-label={`Options for ${calendar.name}`}
          >
            <MoreHorizontalIcon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {isGoogle ? (
            <>
              {calendar.primary ? null : (
                <DropdownMenuItem
                  disabled={!canManage || !calendar.canEdit}
                  onSelect={onRename}
                >
                  Rename
                </DropdownMenuItem>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!canManage}>
                  Color
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="p-2">
                  <CalendarColorSwatches
                    value={calendar.color}
                    onChange={onColor}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem onSelect={onShowOnly}>
            Show only this
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onHideOthers}>
            Hide others
          </DropdownMenuItem>
          {isGoogle && !calendar.primary ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!canManage} onSelect={onDelete}>
                {calendar.canEdit ? "Delete" : "Remove"}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Switch
        size="sm"
        checked={calendar.isEnabled}
        disabled={busy}
        aria-label={`Show ${calendar.name}`}
        onCheckedChange={onToggle}
      />
    </div>
  );
}

function applyToCalendars(
  data: GetCalendarsResponse,
  update: (calendar: PanelCalendar) => PanelCalendar | null,
): GetCalendarsResponse {
  return {
    ...data,
    connections: data.connections.map((connection) => ({
      ...connection,
      calendars: connection.calendars.flatMap((calendar) => {
        const next = update({ ...calendar, connection });
        if (!next) return [];
        const { connection: _connection, ...rest } = next;
        return [rest];
      }),
    })),
  };
}

function dateKeyToLocalNoon(dateKey: string) {
  try {
    const { year, month, day } = parseDateKey(dateKey);
    return new Date(year, month - 1, day, 12);
  } catch {
    return new Date();
  }
}
