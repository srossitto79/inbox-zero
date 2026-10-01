import { describe, expect, it } from "vitest";
import {
  createHostRuntime,
  createMailEngine,
} from "@inboxzero/mail-core/engine";
import type { MailboxSource } from "@inboxzero/mail-core/ports/mailbox-source";
import type { ProviderChange } from "@inboxzero/mail-core/sync";
import { createNodeSqliteDriver } from "./node-sqlite";
import { createSqliteMailStore } from "./store";

const session = { accountId: "acc-1", generation: "g1" };

describe("catch-up during a running bootstrap", () => {
  it("applies new mail before the rest of the download and hands over without replaying it", async () => {
    let now = 1000;
    const calls: string[] = [];
    const store = await createSqliteMailStore(createNodeSqliteDriver());
    await store.ensureAccount({
      accountId: "acc-1",
      provider: "google",
      generation: "g1",
    });
    const engine = createMailEngine({
      store,
      source: downloadWithNewMailSource(calls, () => {
        now += 1000;
      }),
      executor: {
        async execute() {
          return { status: "uncertain", receiptId: null };
        },
        async inspect() {
          return { status: "uncertain", receiptId: null };
        },
      },
      runtime: createHostRuntime({ nowMs: () => now }),
    });
    await engine.requestSync(["acc-1"]);

    await engine.runUntil(1500);
    expect(calls).toEqual(["enumerate:page-1"]);

    // The next run reads new mail before it continues the download.
    await engine.runUntil(now + 500);
    expect(calls).toEqual([
      "enumerate:page-1",
      "changes:h1",
      "enumerate:page-2",
    ]);
    expect(await inboxIds(store)).toContain("m-new");

    // The finished download hands its stream the position catch-up reached.
    expect(
      await store.readBootstrapScan({ session, scopeId: "primary" }),
    ).toBeNull();
    const [account] = await store.readAccountSyncStates();
    expect(account?.streams).toEqual([
      expect.objectContaining({ streamId: "primary", checkpoint: "h2" }),
    ]);
    await engine.close();
  });
});

async function inboxIds(
  store: Awaited<ReturnType<typeof createSqliteMailStore>>,
) {
  const inspection = await store.inspect();
  return inspection.messages.map((message) => message.messageId);
}

function downloadWithNewMailSource(
  calls: string[],
  advanceClock: () => void,
): MailboxSource {
  let changesRead = 0;
  return {
    async describe() {
      return {
        status: "ok",
        value: {
          strategy: "account_history",
          supportedChanges: ["archive"],
          maxPageSize: 50,
          maxHydrationBatch: 20,
        },
      };
    },
    async discoverScopes() {
      return {
        status: "ok",
        value: {
          scopes: [{ id: "primary", kind: "account", folderId: null }],
          nextPage: null,
        },
      };
    },
    async beginBootstrap() {
      return {
        status: "ok",
        value: {
          bootstrapId: "boot",
          enumerationToken: "page-1",
          catchUpFrom: {
            streamId: "primary",
            generation: "g1",
            checkpoint: "h1",
          },
        },
      };
    },
    async enumerate(input) {
      calls.push(`enumerate:${input.page}`);
      advanceClock();
      const last = input.page === "page-2";
      return {
        status: "ok",
        value: {
          bootstrapId: "boot",
          scopeId: "primary",
          changes: [messagePatch(last ? "m-old-2" : "m-old-1")],
          requiredHydration: [],
          bodies: [],
          nextPage: last ? null : "page-2",
          catchUpFrom: null,
        },
      };
    },
    async hydrate() {
      return {
        status: "ok",
        value: { changes: [], bodies: [], unresolved: [] },
      };
    },
    async readAttachment() {
      return { status: "not_found" };
    },
    async readChanges(input) {
      const checkpoint = input.position.checkpoint;
      changesRead += 1;
      calls.push(
        checkpoint === "h1" && changesRead > 1
          ? "changes:h1-again"
          : `changes:${checkpoint}`,
      );
      return {
        status: "page",
        page: {
          session: input.session,
          requestId: input.requestId,
          from: input.position,
          to: { ...input.position, checkpoint: "h2" },
          changes: checkpoint === "h1" ? [messagePatch("m-new")] : [],
          requiredHydration: [],
          roundComplete: true,
        },
      };
    },
    async readConversationMembership() {
      return { status: "ok", value: { status: "not_found" } };
    },
    async search() {
      return { status: "unsupported" };
    },
  };
}

function messagePatch(
  messageId: string,
): Extract<ProviderChange, { kind: "message_patch" }> {
  return {
    kind: "message_patch",
    key: { accountId: "acc-1", messageId },
    reference: {
      provider: "google",
      messageId,
      conversationId: messageId,
      version: "1",
    },
    fields: {
      subject: messageId,
      preview: messageId,
      from: "ada@example.com",
      to: ["me@example.com"],
      cc: [],
      receivedAtMs: 1000,
      read: false,
      starred: false,
      folderId: "inbox",
      labelIds: ["INBOX"],
      categoryIds: [],
      roles: ["inbox"],
      hasAttachments: false,
    },
  };
}
