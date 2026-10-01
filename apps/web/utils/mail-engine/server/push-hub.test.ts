import { describe, expect, it, vi } from "vitest";
import { MAIL_IPC_PROTOCOL_VERSION } from "@inboxzero/mail-core/protocol/mail-ipc";
import type { QuerySnapshot } from "@inboxzero/mail-core/queries";
import {
  closePushConnection,
  openPushConnection,
  subscribePush,
  unsubscribePush,
  type PushEvent,
} from "@/utils/mail-engine/server/push-hub";

vi.mock("server-only", () => ({}));

const engine = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  closed: 0,
  snapshot: {
    status: "ready",
    revision: { value: "1" },
    data: { counts: [] },
    refreshing: false,
    error: null,
  } as unknown as QuerySnapshot<unknown>,
}));

vi.mock("@/utils/mail-engine/server/engine-registry", () => ({
  getServerMailEngine: async () => ({
    observeMailboxCounts: () => ({
      getSnapshot: () => engine.snapshot,
      subscribe: (listener: () => void) => {
        engine.listeners.add(listener);
        return () => engine.listeners.delete(listener);
      },
      close: () => {
        engine.closed += 1;
      },
    }),
  }),
}));

const countsRequest = {
  protocolVersion: MAIL_IPC_PROTOCOL_VERSION,
  requestId: "r1",
  method: "observeMailboxCounts",
  payload: { accountIds: ["acc-1"], targets: [] },
};

describe("server mail push hub", () => {
  it("pushes the current snapshot and each change to the stream", async () => {
    const events: PushEvent[] = [];
    const connectionId = openPushConnection("acc-1", (event) =>
      events.push(event),
    );
    await expect(
      subscribePush({
        emailAccountId: "acc-1",
        connectionId,
        subscriptionId: "s1",
        request: countsRequest,
      }),
    ).resolves.toBe("ok");
    for (const listener of engine.listeners) listener();

    expect(events[0]).toEqual({ type: "connected", connectionId });
    expect(events.slice(1)).toEqual([
      { type: "snapshot", subscriptionId: "s1", snapshot: engine.snapshot },
      { type: "snapshot", subscriptionId: "s1", snapshot: engine.snapshot },
    ]);
    closePushConnection(connectionId);
  });

  it("refuses to attach a subscription to another account's stream", async () => {
    const connectionId = openPushConnection("acc-1", () => undefined);
    await expect(
      subscribePush({
        emailAccountId: "acc-2",
        connectionId,
        subscriptionId: "s1",
        request: countsRequest,
      }),
    ).resolves.toBe("unknown_connection");
    closePushConnection(connectionId);
  });

  it("rejects requests that are not observations", async () => {
    const connectionId = openPushConnection("acc-1", () => undefined);
    await expect(
      subscribePush({
        emailAccountId: "acc-1",
        connectionId,
        subscriptionId: "s1",
        request: { ...countsRequest, method: "purgeAccount" },
      }),
    ).resolves.toBe("invalid");
    closePushConnection(connectionId);
  });

  it("closes observations on unsubscribe and when the stream ends", async () => {
    const connectionId = openPushConnection("acc-1", () => undefined);
    for (const subscriptionId of ["s1", "s2"]) {
      await subscribePush({
        emailAccountId: "acc-1",
        connectionId,
        subscriptionId,
        request: countsRequest,
      });
    }
    const before = engine.closed;
    unsubscribePush({
      emailAccountId: "acc-1",
      connectionId,
      subscriptionId: "s1",
    });
    expect(engine.closed).toBe(before + 1);
    closePushConnection(connectionId);
    expect(engine.closed).toBe(before + 2);
  });
});
