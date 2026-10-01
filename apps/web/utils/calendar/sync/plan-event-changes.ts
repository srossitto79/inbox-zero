import type { EventRowData, SyncItem } from "@/utils/calendar/sync/types";

export type EventChangePlan = {
  upserts: EventRowData[];
  /** Provider ids whose stored row is deleted. */
  removedIds: string[];
  /** Deleted series masters; their stored exceptions go with them. */
  removedSeriesIds: string[];
};

/**
 * Collapses one page of provider changes. A page can mention an event more
 * than once (modified, then cancelled), and only the last mention counts.
 * Removing a series master also drops its exceptions, unless the same page
 * carries a newer version of that exception.
 */
export function planEventChanges(items: SyncItem[]): EventChangePlan {
  const latest = new Map<string, SyncItem>();
  for (const item of items) {
    latest.set(
      item.kind === "upsert" ? item.data.providerEventId : item.providerEventId,
      item,
    );
  }

  const plan: EventChangePlan = {
    upserts: [],
    removedIds: [],
    removedSeriesIds: [],
  };
  for (const item of latest.values()) {
    if (item.kind === "upsert") {
      plan.upserts.push(item.data);
      continue;
    }
    plan.removedIds.push(item.providerEventId);
    if (item.withInstances) plan.removedSeriesIds.push(item.providerEventId);
  }

  const removedSeries = new Set(plan.removedSeriesIds);
  plan.upserts = plan.upserts.filter(
    (row) => !row.recurringEventId || !removedSeries.has(row.recurringEventId),
  );

  return plan;
}
