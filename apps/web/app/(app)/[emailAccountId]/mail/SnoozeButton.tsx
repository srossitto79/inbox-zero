"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Clock3Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getReaderSnoozePresets } from "@/app/(app)/[emailAccountId]/mail/reader-snooze";
import { parseSnoozeDate } from "@/app/(app)/[emailAccountId]/mail/snooze-command-palette";

/** Presets and a typed date, both handed to the same action the palette calls. */
export function SnoozeButton({
  onSnooze,
}: {
  onSnooze: (until: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const now = new Date();
  const presets = open ? getReaderSnoozePresets(now) : [];
  const customDate = custom.trim() ? parseSnoozeDate(custom, now) : null;

  const snooze = (until: Date) => {
    setOpen(false);
    setCustom("");
    onSnooze(until);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button aria-label="Snooze" size="xs" variant="outline">
          <Clock3Icon className="size-3.5" />
          Snooze
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        {presets.map((preset) => (
          <button
            className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted"
            key={preset.id}
            onClick={() => snooze(preset.until)}
            type="button"
          >
            <span>{preset.label}</span>
            <span className="text-muted-foreground text-xs">
              {format(preset.until, "EEE p")}
            </span>
          </button>
        ))}
        <form
          className="mt-1 border-border border-t p-1.5 pt-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (customDate) snooze(customDate);
          }}
        >
          <input
            aria-label="Snooze until"
            className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm placeholder:text-muted-foreground"
            onChange={(event) => setCustom(event.target.value)}
            placeholder="Friday at 3pm"
            value={custom}
          />
          {customDate ? (
            <button
              className="mt-1.5 w-full rounded-md bg-muted px-2.5 py-1.5 text-left text-sm hover:bg-accent"
              type="submit"
            >
              {`Snooze until ${format(customDate, "EEE, MMM d 'at' p")}`}
            </button>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  );
}
