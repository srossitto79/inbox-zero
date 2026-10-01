import { describe, expect, it } from "vitest";
import type { ProviderChange } from "@inboxzero/mail-core/sync";
import { createNodeSqliteDriver, nodeBodyCodec } from "./node-sqlite";
import { createSqliteMailStore } from "./store";
import { readStoredConversation, readStoredMessages } from "./stored-messages";

const session = { accountId: "acc-1", generation: "g1" };

describe("stored messages", () => {
  it("returns headers and body exactly as the provider reported them", async () => {
    const driver = createNodeSqliteDriver();
    const store = await seed(driver);

    await store.applyHydration({
      session,
      requestId: "h1",
      changes: [patch("m1", 1000, { messageId: "<m1@example.com>" })],
      bodies: [
        {
          key: { accountId: "acc-1", messageId: "m1" },
          version: "1",
          html: "<p>hi</p>",
          text: "hi",
        },
      ],
    });

    const [stored] = await readStoredMessages(driver, nodeBodyCodec, {
      accountId: "acc-1",
      messageIds: ["m1", "unknown"],
    });
    expect(stored?.message.headers).toEqual({
      messageId: "<m1@example.com>",
      references: "<root@example.com>",
      listUnsubscribe: "<mailto:unsubscribe@example.com>",
    });
    // HTML messages keep no separate text part.
    expect(stored?.content).toMatchObject({ html: "<p>hi</p>", text: null });
  });

  it("keeps stored headers when a later patch carries none", async () => {
    const driver = createNodeSqliteDriver();
    const store = await seed(driver);
    await store.applyHydration({
      session,
      requestId: "h1",
      changes: [patch("m1", 1000, { messageId: "<m1@example.com>" })],
      bodies: [],
    });
    const labelOnly = patch("m1", 1000, undefined);
    labelOnly.reference.version = "2";
    await store.applyHydration({
      session,
      requestId: "h2",
      changes: [{ ...labelOnly, fields: { ...labelOnly.fields, read: true } }],
      bodies: [],
    });

    const [stored] = await readStoredMessages(driver, nodeBodyCodec, {
      accountId: "acc-1",
      messageIds: ["m1"],
    });
    expect(stored?.message.read).toBe(true);
    expect(stored?.message.headers?.messageId).toBe("<m1@example.com>");
    expect(stored?.content).toBeNull();
  });

  it("reads a conversation oldest first", async () => {
    const driver = createNodeSqliteDriver();
    const store = await seed(driver);
    await store.applyHydration({
      session,
      requestId: "h1",
      changes: [patch("m2", 2000, undefined), patch("m1", 1000, undefined)],
      bodies: [],
    });

    const stored = await readStoredConversation(driver, nodeBodyCodec, {
      accountId: "acc-1",
      conversationId: "c1",
    });
    expect(stored.map((entry) => entry.message.messageId)).toEqual([
      "m1",
      "m2",
    ]);
  });
});

async function seed(driver: ReturnType<typeof createNodeSqliteDriver>) {
  const store = await createSqliteMailStore(driver, {
    bodyCodec: nodeBodyCodec,
  });
  await store.ensureAccount({
    accountId: "acc-1",
    provider: "google",
    generation: "g1",
  });
  return store;
}

function patch(
  messageId: string,
  receivedAtMs: number,
  headers: { messageId: string } | undefined,
): Extract<ProviderChange, { kind: "message_patch" }> {
  return {
    kind: "message_patch",
    key: { accountId: "acc-1", messageId },
    reference: {
      provider: "google",
      messageId,
      conversationId: "c1",
      version: "1",
    },
    fields: {
      subject: "Hello",
      preview: "hi",
      from: "ada@example.com",
      to: ["me@example.com"],
      cc: [],
      receivedAtMs,
      read: false,
      starred: false,
      folderId: "inbox",
      labelIds: [],
      categoryIds: [],
      roles: ["inbox"],
      hasAttachments: false,
      ...(headers
        ? {
            headers: {
              ...headers,
              references: "<root@example.com>",
              listUnsubscribe: "<mailto:unsubscribe@example.com>",
            },
          }
        : {}),
    },
  };
}
