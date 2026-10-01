import {
  createMailIpcClient,
  type MailIpcPushTransport,
  type MailIpcSnapshotEvent,
} from "@inboxzero/mail-core/protocol/mail-ipc-client";
import { EMAIL_ACCOUNT_HEADER } from "@/utils/config";
import {
  pageConnectivityOnline,
  requestSyncUnlessOffline,
} from "@/utils/mail-engine/worker-protocol";

const MIN_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;

type PushEvent =
  | { type: "connected"; connectionId: string }
  | { type: "snapshot"; subscriptionId: string; snapshot: unknown };

/**
 * The mail client for NEXT_PUBLIC_MAIL_STORE=server: the engine and its mailbox
 * live on the server, calls go over HTTP and snapshots arrive on a stream.
 */
export function createServerMailClient(input: {
  accountId: string;
  provider: "google" | "microsoft";
}) {
  const base = `/api/mail/v1/accounts/${encodeURIComponent(input.accountId)}/engine`;
  const accountHeader = { [EMAIL_ACCOUNT_HEADER]: input.accountId };
  const jsonHeaders = { ...accountHeader, "content-type": "application/json" };
  const listeners = new Set<(event: MailIpcSnapshotEvent) => void>();
  const active = new Map<string, unknown>();
  const streamAbort = new AbortController();
  let connectionId: string | null = null;
  let waiters: Array<(id: string) => void> = [];
  let stopped = false;

  const connected = () =>
    connectionId
      ? Promise.resolve(connectionId)
      : new Promise<string>((resolve) => waiters.push(resolve));

  async function postSubscription(subscriptionId: string, request: unknown) {
    const response = await fetch(`${base}/subscriptions`, {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify({
        connectionId: await connected(),
        subscriptionId,
        request,
      }),
    });
    return response.json().catch(() => ({ status: "unavailable" }));
  }

  const push: MailIpcPushTransport = {
    subscribe({ subscriptionId, request }) {
      active.set(subscriptionId, request);
      return postSubscription(subscriptionId, request);
    },
    async unsubscribe(subscriptionId) {
      active.delete(subscriptionId);
      if (!connectionId) return { status: "ok" };
      const response = await fetch(`${base}/subscriptions`, {
        method: "DELETE",
        credentials: "include",
        headers: jsonHeaders,
        body: JSON.stringify({ connectionId, subscriptionId }),
      });
      return response.json().catch(() => ({ status: "ok" }));
    },
    onSnapshot(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  const onEvent = (event: PushEvent, reconnected: boolean) => {
    if (event.type === "snapshot") {
      for (const listener of listeners) listener(event);
      return;
    }
    connectionId = event.connectionId;
    for (const resolve of waiters) resolve(event.connectionId);
    waiters = [];
    // A new stream has no subscriptions; reopen the ones still in use.
    if (reconnected) {
      for (const [subscriptionId, request] of active) {
        postSubscription(subscriptionId, request).catch(() => undefined);
      }
    }
  };

  (async () => {
    let backoff = MIN_RECONNECT_MS;
    let hadConnection = false;
    while (!stopped) {
      try {
        const response = await fetch(`${base}/stream`, {
          credentials: "include",
          headers: { ...accountHeader, accept: "text/event-stream" },
          signal: streamAbort.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`Mail engine stream failed: ${response.status}`);
        }
        backoff = MIN_RECONNECT_MS;
        const reconnected = hadConnection;
        hadConnection = true;
        await readServerSentEvents(response.body, (event) =>
          onEvent(event, reconnected),
        );
      } catch {
        // Retried below unless the client was closed.
      }
      connectionId = null;
      if (stopped) return;
      await delay(backoff);
      backoff = Math.min(backoff * 2, MAX_RECONNECT_MS);
    }
  })();

  const client = createMailIpcClient(
    async (payload) => {
      const response = await fetch(base, {
        method: "POST",
        credentials: "include",
        headers: jsonHeaders,
        body: JSON.stringify(payload),
      });
      return response.json().catch(() => ({ status: "unavailable" }));
    },
    { push, provider: input.provider },
  );

  const closeClient = client.close.bind(client);
  const requestSync = client.requestSync.bind(client);
  return Object.assign(client, {
    requestSync: (accountIds: string[]) =>
      requestSyncUnlessOffline(pageConnectivityOnline(), () =>
        requestSync(accountIds),
      ),
    async close() {
      stopped = true;
      streamAbort.abort();
      await closeClient();
    },
  });
}

async function readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: PushEvent) => void,
) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += value;
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (data) onEvent(JSON.parse(data) as PushEvent);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
