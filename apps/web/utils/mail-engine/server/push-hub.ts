import "server-only";
import { randomUUID } from "node:crypto";
import {
  isObservationRequest,
  openMailIpcObservation,
  parseMailIpcRequest,
} from "@inboxzero/mail-core/protocol/mail-ipc-host";
import { getServerMailEngine } from "@/utils/mail-engine/server/engine-registry";

export type PushEvent =
  | { type: "connected"; connectionId: string }
  | { type: "snapshot"; subscriptionId: string; snapshot: unknown };

type Connection = {
  emailAccountId: string;
  send: (event: PushEvent) => void;
  subscriptions: Map<string, () => void>;
};

// Streams and subscribe requests arrive as separate requests to one process.
const hubKey = Symbol.for("inbox-zero.server-mail-push");
const globalHub = globalThis as typeof globalThis & {
  [hubKey]?: Map<string, Connection>;
};

function connections() {
  globalHub[hubKey] ??= new Map();
  return globalHub[hubKey];
}

export function openPushConnection(
  emailAccountId: string,
  send: (event: PushEvent) => void,
) {
  const connectionId = randomUUID();
  connections().set(connectionId, {
    emailAccountId,
    send,
    subscriptions: new Map(),
  });
  send({ type: "connected", connectionId });
  return connectionId;
}

export function closePushConnection(connectionId: string) {
  const connection = connections().get(connectionId);
  if (!connection) return;
  for (const close of connection.subscriptions.values()) close();
  connections().delete(connectionId);
}

/** Keeps an observation open and pushes each settled snapshot down the stream. */
export async function subscribePush(input: {
  emailAccountId: string;
  connectionId: string;
  subscriptionId: string;
  request: unknown;
}): Promise<"ok" | "invalid" | "unknown_connection"> {
  const connection = connections().get(input.connectionId);
  if (!connection || connection.emailAccountId !== input.emailAccountId) {
    return "unknown_connection";
  }
  const parsed = parseMailIpcRequest(input.request);
  if (!parsed.success || !isObservationRequest(parsed.data)) return "invalid";

  connection.subscriptions.get(input.subscriptionId)?.();
  // Reserved before awaiting the engine so an early unsubscribe wins.
  let cancelled = false;
  connection.subscriptions.set(input.subscriptionId, () => {
    cancelled = true;
  });

  const engine = await getServerMailEngine(input.emailAccountId);
  if (cancelled) return "ok";
  const handle = openMailIpcObservation(engine, parsed.data);
  const send = () => {
    const snapshot = handle.getSnapshot();
    if (snapshot.status === "loading") return;
    connection.send({
      type: "snapshot",
      subscriptionId: input.subscriptionId,
      snapshot,
    });
  };
  const unsubscribe = handle.subscribe(send);
  connection.subscriptions.set(input.subscriptionId, () => {
    unsubscribe();
    handle.close();
  });
  send();
  return "ok";
}

export function unsubscribePush(input: {
  emailAccountId: string;
  connectionId: string;
  subscriptionId: string;
}) {
  const connection = connections().get(input.connectionId);
  if (!connection || connection.emailAccountId !== input.emailAccountId) return;
  connection.subscriptions.get(input.subscriptionId)?.();
  connection.subscriptions.delete(input.subscriptionId);
}
