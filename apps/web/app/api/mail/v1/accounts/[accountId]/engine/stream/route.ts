import { NextResponse } from "next/server";
import { withEmailAccount } from "@/utils/middleware";
import {
  accountMismatchResponse,
  mailRequestId,
} from "@/utils/mail-api/authorization";
import {
  closePushConnection,
  openPushConnection,
} from "@/utils/mail-engine/server/push-hub";
import { isServerMailStore } from "@/utils/mail-engine/mail-store-mode";

export const maxDuration = 300;

const HEARTBEAT_MS = 25_000;
// Ends before maxDuration; the client reconnects and resubscribes.
const LIFETIME_MS = 270_000;

/** Server-sent snapshots for the observations this browser subscribed to. */
export const GET = withEmailAccount(
  "mail/v1/engine/stream",
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

    const emailAccountId = request.auth.emailAccountId;
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let connectionId: string | null = null;
        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          clearTimeout(lifetime);
          request.signal.removeEventListener("abort", close);
          if (connectionId) closePushConnection(connectionId);
          try {
            controller.close();
          } catch {
            /* The reader may already be cancelled. */
          }
        };
        cleanup = close;
        const write = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            close();
          }
        };
        const heartbeat = setInterval(
          () => write(": heartbeat\n\n"),
          HEARTBEAT_MS,
        );
        const lifetime = setTimeout(close, LIFETIME_MS);
        request.signal.addEventListener("abort", close);
        if (request.signal.aborted) {
          close();
          return;
        }
        connectionId = openPushConnection(emailAccountId, (event) => {
          write(`data: ${JSON.stringify(event)}\n\n`);
        });
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  },
);
