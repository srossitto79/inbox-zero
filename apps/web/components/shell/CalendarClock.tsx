"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";

/** The current date and time, shown under the calendar heading. */
export function CalendarClock() {
  const [label, setLabel] = useState("");

  useEffect(() => {
    const update = () => setLabel(format(new Date(), "EEEE d MMMM yyyy HH:mm"));
    update();
    const timer = setInterval(update, 10_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-4 px-1 pt-0.5 text-muted-foreground text-xs tabular-nums">
      {label}
    </div>
  );
}
