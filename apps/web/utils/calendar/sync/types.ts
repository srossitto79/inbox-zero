import type { Prisma } from "@/generated/prisma/client";

export type EventRowData = Omit<
  Prisma.CalendarEventCreateManyInput,
  "id" | "calendarId" | "createdAt" | "updatedAt"
>;

export type SyncItem =
  | { kind: "upsert"; data: EventRowData }
  // `withInstances` also drops the exceptions of a deleted series master.
  | { kind: "remove"; providerEventId: string; withInstances: boolean };

export type EventSyncPage = {
  items: SyncItem[];
  /** Present while the provider has more pages for this request. */
  nextPageToken: string | null;
  /** Present on the last page: the cursor for the next incremental sync. */
  nextCursor: string | null;
};

export type EventSyncRequest = {
  calendarId: string;
  /** Google syncToken or Microsoft deltaLink; null for a full sync. */
  cursor: string | null;
  /** Resumes a paginated response (Google pageToken, Microsoft nextLink). */
  pageToken: string | null;
  window: { from: Date; to: Date };
  /** Zone to assume for events that do not carry their own. */
  calendarTimeZone: string | null;
};

export interface EventSyncSource {
  /** Throws SyncCursorExpiredError when the provider no longer knows the cursor. */
  fetchPage(request: EventSyncRequest): Promise<EventSyncPage>;
}

export class SyncCursorExpiredError extends Error {
  constructor() {
    super("Calendar sync cursor expired");
    this.name = "SyncCursorExpiredError";
  }
}
