import { NextResponse } from "next/server";
import { env } from "@/env";
import { hasCronSecret } from "@/utils/cron";
import { withError } from "@/utils/middleware";
import { captureException } from "@/utils/error";
import { pollGmailAccounts } from "@/utils/webhook/google/poll-gmail";

export const maxDuration = 300;

export const GET = withError("cron/poll-gmail", async (request) => {
  if (!hasCronSecret(request)) {
    captureException(
      new Error("Unauthorized cron request: api/cron/poll-gmail"),
    );
    return new Response("Unauthorized", { status: 401 });
  }

  if (!env.GMAIL_POLLING_ENABLED) {
    return NextResponse.json({ enabled: false });
  }

  const result = await pollGmailAccounts(request.logger);
  return NextResponse.json({ enabled: true, ...result });
});
