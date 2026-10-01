import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";

export type GetMailboxSizeResponse = { threads: number | null };

export const maxDuration = 30;

export const GET = withEmailProvider("user/mailbox-size", async (request) => {
  const threads = await request.emailProvider.getMailboxThreadTotal();
  return NextResponse.json({ threads } satisfies GetMailboxSizeResponse);
});
