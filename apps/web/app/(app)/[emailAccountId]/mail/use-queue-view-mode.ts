import { useCallback, useEffect, useState } from "react";
import {
  readQueueViewMode,
  writeQueueViewMode,
  type QueueViewMode,
} from "@/app/(app)/[emailAccountId]/mail/queue-grouping";

/** Per-browser list grouping choice; starts on queues until storage is read. */
export function useQueueViewMode() {
  const [mode, setMode] = useState<QueueViewMode>("queues");

  useEffect(() => {
    setMode(readQueueViewMode());
  }, []);

  const update = useCallback((next: QueueViewMode) => {
    setMode(next);
    writeQueueViewMode(next);
  }, []);

  return [mode, update] as const;
}
