"use client";

import { CheckIcon } from "lucide-react";
import { CALENDAR_COLOR_SWATCHES } from "@/utils/calendar/manage/colors";
import { cn } from "@/utils";

export function CalendarColorSwatches({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CALENDAR_COLOR_SWATCHES.map((swatch) => {
        const selected = value?.toLowerCase() === swatch.value;
        return (
          <button
            key={swatch.value}
            type="button"
            aria-label={swatch.name}
            aria-pressed={selected}
            onClick={() => onChange(swatch.value)}
            className={cn(
              "flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected && "ring-2 ring-foreground/40 ring-offset-1",
            )}
            style={{ backgroundColor: swatch.value }}
          >
            {selected ? <CheckIcon className="size-3.5 text-white" /> : null}
          </button>
        );
      })}
    </div>
  );
}
