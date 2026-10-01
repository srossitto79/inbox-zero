import { NextResponse } from "next/server";
import { z } from "zod";
import { withEmailAccount } from "@/utils/middleware";
import {
  accountMismatchResponse,
  mailRequestId,
} from "@/utils/mail-api/authorization";
import {
  subscribePush,
  unsubscribePush,
} from "@/utils/mail-engine/server/push-hub";
import { isServerMailStore } from "@/utils/mail-engine/mail-store-mode";

const subscriptionBody = z.object({
  connectionId: z.string().min(1).max(64),
  subscriptionId: z.string().min(1).max(128),
  request: z.unknown(),
});

const unsubscriptionBody = subscriptionBody.omit({ request: true });

export const maxDuration = 30;

/** Opens an engine observation whose snapshots arrive on the engine stream. */
export const POST = withEmailAccount(
  "mail/v1/engine/subscriptions",
  async (request, context) => {
    if (!isServerMailStore()) {
      return NextResponse.json({ status: "unsupported" }, { status: 404 });
    }
    const params = await context.params;
    const mismatch = accountMismatchResponse(
      request,
      params.accountId,
      mailRequestId(request),
    );
    if (mismatch) return mismatch;
    const parsed = subscriptionBody.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json({ status: "invalid" }, { status: 400 });
    }
    const status = await subscribePush({
      emailAccountId: request.auth.emailAccountId,
      ...parsed.data,
    });
    return NextResponse.json(
      { status },
      { status: status === "ok" ? 200 : status === "invalid" ? 400 : 409 },
    );
  },
);

export const DELETE = withEmailAccount(
  "mail/v1/engine/subscriptions",
  async (request, context) => {
    if (!isServerMailStore()) {
      return NextResponse.json({ status: "unsupported" }, { status: 404 });
    }
    const params = await context.params;
    const mismatch = accountMismatchResponse(
      request,
      params.accountId,
      mailRequestId(request),
    );
    if (mismatch) return mismatch;
    const parsed = unsubscriptionBody.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json({ status: "invalid" }, { status: 400 });
    }
    unsubscribePush({
      emailAccountId: request.auth.emailAccountId,
      ...parsed.data,
    });
    return NextResponse.json({ status: "ok" });
  },
);
