"use client";

import { useCallback, useEffect, useState } from "react";
import {
  readCollapsedQueueLabels,
  writeCollapsedQueueLabels,
} from "@/app/(app)/[emailAccountId]/mail/queue-grouping";

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Group labels the user hid from the list. Queue labels persist per browser
 * (hiding Newsletters should survive a reload); date labels are session-only,
 * because "Yesterday" means different mail tomorrow.
 *
 * `toggle` takes the current set so callers can partition the list with the
 * next set synchronously — the focus row must be re-anchored in the same
 * commit that hides it.
 */
export function useCollapsedGroups(groupByQueue: boolean) {
  const [queueLabels, setQueueLabels] = useState<ReadonlySet<string>>(EMPTY);
  const [dayLabels, setDayLabels] = useState<ReadonlySet<string>>(EMPTY);

  useEffect(() => {
    setQueueLabels(readCollapsedQueueLabels());
  }, []);

  const toggle = useCallback(
    (label: string, current: ReadonlySet<string>) => {
      const next = new Set(current);
      if (!next.delete(label)) next.add(label);

      if (groupByQueue) {
        writeCollapsedQueueLabels(next);
        setQueueLabels(next);
      } else {
        setDayLabels(next);
      }
      return next;
    },
    [groupByQueue],
  );

  return { collapsedLabels: groupByQueue ? queueLabels : dayLabels, toggle };
}
