import { NextResponse } from "next/server";
import { env } from "@/env";
import { hasCronSecret } from "@/utils/cron";
import { withError } from "@/utils/middleware";
import { captureException } from "@/utils/error";
import { syncDueCalendars } from "@/utils/calendar/sync/sync-calendars";

export const maxDuration = 300;

// Leaves headroom under maxDuration for the calendar being synced when the
// deadline passes.
const RUN_BUDGET_MS = 240_000;

export const GET = withError("cron/sync-calendars", async (request) => {
  if (!hasCronSecret(request)) {
    captureException(
      new Error("Unauthorized cron request: api/cron/sync-calendars"),
    );
    return new Response("Unauthorized", { status: 401 });
  }

  if (!env.CALENDAR_SYNC_ENABLED) {
    return NextResponse.json({ enabled: false });
  }

  const result = await syncDueCalendars({
    logger: request.logger,
    deadline: Date.now() + RUN_BUDGET_MS,
  });
  request.logger.info("Finished syncing calendars", result);

  return NextResponse.json({ enabled: true, ...result });
});
