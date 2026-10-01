import { NextResponse } from "next/server";
import { dispatchMailIpc } from "@inboxzero/mail-core/protocol/mail-ipc-host";
import { withEmailAccount } from "@/utils/middleware";
import {
  accountMismatchResponse,
  mailRequestId,
} from "@/utils/mail-api/authorization";
import { getServerMailEngine } from "@/utils/mail-engine/server/engine-registry";
import { isServerMailStore } from "@/utils/mail-engine/mail-store-mode";

export const maxDuration = 60;

/** One `createMailIpcClient` call against this account's server mail engine. */
export const POST = withEmailAccount(
  "mail/v1/engine",
  async (request, context) => {
    if (!isServerMailStore()) {
      return NextResponse.json({ status: "unsupported" }, { status: 404 });
    }
    const params = await context.params;
    const body = await request.json().catch(() => null);
    const mismatch = accountMismatchResponse(
      request,
      params.accountId,
      mailRequestId(request, body ?? undefined),
    );
    if (mismatch) return mismatch;
    const engine = await getServerMailEngine(request.auth.emailAccountId);
    return NextResponse.json(await dispatchMailIpc(engine, body));
  },
);
