"use client";

import { useCallback, useRef, useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { DownloadIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccount } from "@/providers/EmailAccountProvider";
import { createCalendarEventAction } from "@/utils/actions/calendar-event";
import { toastError, toastSuccess } from "@/components/Toast";
import { EMAIL_ACCOUNT_HEADER } from "@/utils/config";
import { editorStateToCreatePayload } from "@/utils/calendar/event-editor-state";
import { buildExportUrl } from "@/utils/calendar/ics/export-url";
import {
  IcsParseError,
  parseIcs,
  type ParsedIcsEvent,
} from "@/utils/calendar/ics/parse-ics";
import { parsedIcsToEditorState } from "@/utils/calendar/ics/import-event";

export function CalendarImportExport({
  range,
  timezone,
  calendars,
  importCalendar,
  onImported,
}: {
  range: { from: Date; to: Date };
  timezone: string;
  /** Calendars shown in the export menu: whatever the view is displaying. */
  calendars: Array<{ id: string; name: string }>;
  /** Where imported events go. Null when nothing can be written to. */
  importCalendar: { id: string; name: string } | null;
  onImported: () => unknown;
}) {
  const { emailAccountId } = useAccount();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedIcsEvent[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const { executeAsync: createEvent } = useAction(
    createCalendarEventAction.bind(null, emailAccountId),
  );

  const exportUrl = useCallback(
    (calendarId?: string) =>
      buildExportUrl({ from: range.from, to: range.to, calendarId }),
    [range],
  );

  const download = useCallback(
    async (url: string) => {
      try {
        const response = await fetch(url, {
          headers: { [EMAIL_ACCOUNT_HEADER]: emailAccountId },
        });
        if (!response.ok) {
          toastError({ description: "Nothing to export" });
          return;
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = `calendar-${range.from.toISOString().slice(0, 10)}.ics`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
      } catch {
        toastError({ description: "Could not export the calendar" });
      }
    },
    [emailAccountId, range],
  );

  const readFile = useCallback(
    async (file: File) => {
      try {
        const events = parseIcs(await file.text(), {
          floatingTimeZone: timezone,
        });
        if (events.length === 0) {
          toastError({ description: "Calendar file has no events" });
          return;
        }
        setParsed(events);
        setSelected(new Set(events.map((_, index) => index)));
      } catch (error) {
        toastError({
          description:
            error instanceof IcsParseError
              ? error.message
              : "Could not read file",
        });
      }
    },
    [timezone],
  );

  const toggle = (index: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const runImport = async () => {
    if (!parsed || !importCalendar) return;
    const chosen = [...selected].map((index) => parsed[index]);
    setImporting(true);
    // The write layer creates one event at a time; an import is a thin loop over it.
    const results = await Promise.allSettled(
      chosen.map((event) =>
        createEvent(
          editorStateToCreatePayload(
            parsedIcsToEditorState({
              event,
              calendarId: importCalendar.id,
              viewerTimeZone: timezone,
            }),
          ),
        ),
      ),
    );
    setImporting(false);
    const created = results.filter(
      (result) => result.status === "fulfilled" && !result.value?.serverError,
    ).length;
    if (created < chosen.length) {
      toastError({
        description: `Created ${created} of ${chosen.length} events`,
      });
    } else {
      toastSuccess({ description: `Imported ${created} events` });
    }
    setParsed(null);
    await onImported();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghostMuted"
            size="iconSm"
            aria-label="Export"
            title="Export"
          >
            <DownloadIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Export this view</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => download(exportUrl())}>
            All selected calendars
          </DropdownMenuItem>
          {calendars.length > 0 ? <DropdownMenuSeparator /> : null}
          {calendars.map((calendar) => (
            <DropdownMenuItem
              key={calendar.id}
              onClick={() => download(exportUrl(calendar.id))}
            >
              {calendar.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        type="file"
        ref={fileInputRef}
        accept=".ics,text/calendar"
        aria-label="Import events from an .ics file"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (file) await readFile(file);
          event.target.value = "";
        }}
      />
      <Button
        variant="ghostMuted"
        size="iconSm"
        aria-label="Import"
        title="Import"
        disabled={!importCalendar}
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadIcon className="size-4" />
      </Button>

      <Dialog
        open={parsed !== null}
        onOpenChange={(open) => !open && !importing && setParsed(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import events</DialogTitle>
            <DialogDescription>
              Events are added to {importCalendar?.name ?? "a calendar"}.
              Recurring events are imported as a single event.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {(parsed ?? []).map((event, index) => (
              <div
                key={`${event.uid}-${index}`}
                className="flex items-center gap-3 rounded-md px-2 py-1.5"
              >
                <Checkbox
                  checked={selected.has(index)}
                  onCheckedChange={() => toggle(index)}
                  aria-label={event.title || "Untitled event"}
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {event.title || "(untitled)"}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatImportTime(event, timezone)}
                </span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setParsed(null)}
              disabled={importing}
            >
              Cancel
            </Button>
            <Button onClick={runImport} loading={importing}>
              Import {selected.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatImportTime(event: ParsedIcsEvent, viewerTimeZone: string) {
  const zone = event.isAllDay ? "UTC" : (event.timeZone ?? viewerTimeZone);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: event.isAllDay ? undefined : "numeric",
    timeZone: zone,
  }).format(event.start);
}
