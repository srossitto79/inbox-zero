import { describe, expect, it } from "vitest";
import type { MessageMetadata } from "@inboxzero/mail-core/messages";
import { createNodeSqliteDriver, nodeBodyCodec } from "./node-sqlite";
import { createSqliteMailStore } from "./store";
import {
  countStoredMessages,
  findStoredParticipantConversations,
  findStoredParticipantMessages,
  readStoredConversationMessages,
  readStoredConversationPage,
  readStoredMessagePage,
} from "./stored-queries";

const session = { accountId: "acc-1", generation: "g1" };

type Seed = {
  id: string;
  conversationId: string;
  receivedAtMs: number;
  from?: string;
  to?: string[];
  cc?: string[];
  read?: boolean;
  roles?: MessageMetadata["roles"];
};

describe("stored queries", () => {
  it("pages messages newest first with a cursor that continues the listing", async () => {
    const { driver } = await seed([
      { id: "m1", conversationId: "c1", receivedAtMs: 1000 },
      { id: "m2", conversationId: "c2", receivedAtMs: 2000 },
      { id: "m3", conversationId: "c3", receivedAtMs: 3000 },
    ]);
    const predicate = { kind: "role", role: "inbox" } as const;

    const first = await readStoredMessagePage(driver, {
      accountId: "acc-1",
      predicate,
      limit: 2,
      after: null,
    });
    expect(first.messages.map((message) => message.messageId)).toEqual([
      "m3",
      "m2",
    ]);
    expect(first.nextPage).not.toBeNull();

    const second = await readStoredMessagePage(driver, {
      accountId: "acc-1",
      predicate,
      limit: 2,
      after: first.nextPage,
    });
    expect(second.messages.map((message) => message.messageId)).toEqual(["m1"]);
    expect(second.nextPage).toBeNull();
  });

  it("reports metadata coverage as incomplete until a round completes", async () => {
    const { driver } = await seed([
      { id: "m1", conversationId: "c1", receivedAtMs: 1000 },
    ]);
    const before = await countStoredMessages(driver, {
      accountId: "acc-1",
      predicate: { kind: "role", role: "inbox" },
    });
    expect(before.coverage.every((item) => item.metadata === "partial")).toBe(
      true,
    );

    await completeCoverage(driver);
    const after = await countStoredMessages(driver, {
      accountId: "acc-1",
      predicate: { kind: "role", role: "inbox" },
    });
    expect(after.coverage.every((item) => item.metadata === "complete")).toBe(
      true,
    );
  });

  it("counts messages, not conversations", async () => {
    const { driver } = await seed([
      { id: "m1", conversationId: "c1", receivedAtMs: 1000, read: true },
      { id: "m2", conversationId: "c1", receivedAtMs: 2000 },
      { id: "m3", conversationId: "c2", receivedAtMs: 3000 },
    ]);

    const counts = await countStoredMessages(driver, {
      accountId: "acc-1",
      predicate: { kind: "role", role: "inbox" },
    });
    expect(counts).toMatchObject({ total: 3, unread: 2 });
  });

  it("lists conversations and their messages oldest first", async () => {
    const { driver } = await seed([
      { id: "m1", conversationId: "c1", receivedAtMs: 1000 },
      { id: "m2", conversationId: "c1", receivedAtMs: 2000 },
      { id: "m3", conversationId: "c2", receivedAtMs: 1500 },
    ]);

    const page = await readStoredConversationPage(driver, {
      accountIds: ["acc-1"],
      predicate: { kind: "role", role: "inbox" },
      order: "newest_first",
      pageSize: 10,
      after: null,
    });
    expect(page.conversationIds).toEqual(["c1", "c2"]);

    const messages = await readStoredConversationMessages(driver, {
      accountId: "acc-1",
      conversationIds: page.conversationIds,
    });
    expect(messages.get("c1")?.map((message) => message.messageId)).toEqual([
      "m1",
      "m2",
    ]);
  });

  it("finds participants by sender, recipient or cc, skipping spam and trash", async () => {
    const { driver } = await seed([
      {
        id: "m1",
        conversationId: "c1",
        receivedAtMs: 1000,
        from: "Ada <ada@example.com>",
      },
      {
        id: "m2",
        conversationId: "c2",
        receivedAtMs: 2000,
        cc: ["Bob <bob@example.com>"],
      },
      {
        id: "m3",
        conversationId: "c3",
        receivedAtMs: 3000,
        to: ["bob@example.com"],
        roles: ["trash"],
      },
      {
        id: "m4",
        conversationId: "c4",
        receivedAtMs: 4000,
        to: ["bob@example.com"],
        roles: ["sent"],
      },
    ]);

    const recipients = await findStoredParticipantMessages(driver, {
      accountId: "acc-1",
      term: "bob@example.com",
      fields: ["to"],
      limit: 10,
    });
    expect(recipients.messageIds).toEqual(["m4", "m2"]);

    const sent = await findStoredParticipantMessages(driver, {
      accountId: "acc-1",
      term: "bob@example.com",
      fields: ["to"],
      sentOnly: true,
      limit: 10,
    });
    expect(sent.messageIds).toEqual(["m4"]);

    const earlier = await findStoredParticipantMessages(driver, {
      accountId: "acc-1",
      term: "example.com",
      fields: ["from", "to"],
      receivedBeforeMs: 2000,
      excludeMessageId: "m1",
      limit: 10,
    });
    expect(earlier.messageIds).toEqual([]);

    const conversations = await findStoredParticipantConversations(driver, {
      accountId: "acc-1",
      term: "example.com",
      fields: ["from", "to"],
      limit: 2,
    });
    expect(conversations.conversationIds).toEqual(["c4", "c2"]);
  });
});

async function seed(messages: Seed[]) {
  const driver = createNodeSqliteDriver();
  const store = await createSqliteMailStore(driver, {
    bodyCodec: nodeBodyCodec,
  });
  await store.ensureAccount({
    accountId: "acc-1",
    provider: "google",
    generation: "g1",
  });
  await store.applyHydration({
    session,
    requestId: "seed",
    changes: messages.map((message) => ({
      kind: "message_patch" as const,
      key: { accountId: "acc-1", messageId: message.id },
      reference: {
        provider: "google" as const,
        messageId: message.id,
        conversationId: message.conversationId,
        version: "1",
      },
      fields: {
        subject: "Hello",
        preview: "hi",
        from: message.from ?? "ada@example.com",
        to: message.to ?? ["me@example.com"],
        cc: message.cc ?? [],
        receivedAtMs: message.receivedAtMs,
        read: message.read ?? false,
        starred: false,
        folderId: null,
        labelIds: [],
        categoryIds: [],
        roles: message.roles ?? ["inbox"],
        hasAttachments: false,
      },
    })),
    bodies: [],
  });
  return { driver, store };
}

function completeCoverage(driver: ReturnType<typeof createNodeSqliteDriver>) {
  return driver.write(async (tx) => {
    await tx.execute(
      `INSERT INTO coverage(account_id, scope_id, metadata, content, indexed_content, last_completed_sync_at_ms)
       VALUES ('acc-1', 'account:all', 'complete', 'partial', 'partial', ?)`,
      [Date.now()],
    );
  });
}
