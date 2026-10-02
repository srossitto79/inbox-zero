import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqliteDriver } from "@inboxzero/mail-sqlite/driver";
import {
  createNodeSqliteDriver,
  nodeBodyCodec,
} from "@inboxzero/mail-sqlite/node";
import { createSqliteMailStore } from "@inboxzero/mail-sqlite/store";
import type { EmailProvider } from "@/utils/email/types";
import { createScopedLogger } from "@/utils/logger";
import { withStoredMailReads } from "@/utils/mail-engine/server/stored-reads";
import type { ParsedMessage } from "@/utils/types";

const registry = vi.hoisted(() => ({
  driver: null as SqliteDriver | null,
  failure: null as Error | null,
}));

vi.mock("@/utils/mail-engine/server/engine-registry", () => ({
  getServerMailboxDriver: async () => {
    if (registry.failure) throw registry.failure;
    return registry.driver;
  },
}));

const logger = createScopedLogger("stored-query-reads-test");
const session = { accountId: "acc-1", generation: "g1" };

type Seed = {
  id: string;
  conversationId: string;
  receivedAtMs: number;
  from?: string;
  to?: string[];
  read?: boolean;
  roles?: Array<"inbox" | "sent" | "draft" | "trash" | "spam">;
};

describe("stored query reads", () => {
  beforeEach(() => {
    registry.failure = null;
  });

  describe("getThreadsWithQuery", () => {
    it("lists threads from the store without asking the provider", async () => {
      await seedMailbox(
        [
          { id: "m1", conversationId: "c1", receivedAtMs: 1000 },
          { id: "m2", conversationId: "c1", receivedAtMs: 2000 },
          { id: "m3", conversationId: "c2", receivedAtMs: 3000 },
        ],
        { complete: true },
      );
      const target = providerStub();
      const provider = withStoredMailReads(target, "acc-1", logger);

      const page = await provider.getThreadsWithQuery({
        query: { type: "inbox" },
        maxResults: 10,
        messageFormat: "metadata",
      });

      expect(target.getThreadsWithQuery).not.toHaveBeenCalled();
      expect(page.threads.map((thread) => thread.id)).toEqual(["c2", "c1"]);
      expect(page.threads[1].messages.map((message) => message.id)).toEqual([
        "m1",
        "m2",
      ]);
      expect(page.threads[1].messages[0]).toMatchObject({
        threadId: "c1",
        subject: "Hello",
        headers: { from: "ada@example.com", "message-id": "<m1@example.com>" },
      });
      expect(page.threads[1].messages[0].textHtml).toBeUndefined();
      expect(page.nextPageToken).toBeUndefined();
    });

    it("hydrates full threads through the message reads", async () => {
      await seedMailbox(
        [{ id: "m1", conversationId: "c1", receivedAtMs: 1000 }],
        { complete: true },
      );
      const target = providerStub();
      const provider = withStoredMailReads(target, "acc-1", logger);

      const page = await provider.getThreadsWithQuery({
        query: { type: "inbox" },
      });

      expect(target.getThreadsWithQuery).not.toHaveBeenCalled();
      expect(target.getMessagesBatch).toHaveBeenCalledWith(["m1"]);
      expect(page.threads[0].messages[0].textPlain).toBe("body of m1");
    });

    it("asks the provider when coverage is incomplete", async () => {
      await seedMailbox(
        [{ id: "m1", conversationId: "c1", receivedAtMs: 1000 }],
        { complete: false },
      );
      const target = providerStub();
      const provider = withStoredMailReads(target, "acc-1", logger);

      const page = await provider.getThreadsWithQuery({
        query: { type: "inbox" },
        messageFormat: "metadata",
      });

      expect(target.getThreadsWithQuery).toHaveBeenCalledTimes(1);
      expect(page.nextPageToken).toBe("provider-token");
    });

    it("asks the provider when the last completed sync is old", async () => {
      await seedMailbox(
        [{ id: "m1", conversationId: "c1", receivedAtMs: 1000 }],
        { complete: true, syncedAtMs: Date.now() - 60 * 60_000 },
      );
      const target = providerStub();
      const provider = withStoredMailReads(target, "acc-1", logger);

      await provider.getThreadsWithQuery({ query: { type: "inbox" } });

      expect(target.getThreadsWithQuery).toHaveBeenCalledTimes(1);
    });

    it("asks the provider for queries the store cannot reproduce", async () => {
      await seedMailbox(
        [{ id: "m1", conversationId: "c1", receivedAtMs: 1000 }],
        { complete: true },
      );
      const target = providerStub();
      const provider = withStoredMailReads(target, "acc-1", logger);

      await provider.getThreadsWithQuery({
        query: { type: "inbox", excludeLabelNames: ["Archived"] },
      });
      await provider.getThreadsWithQuery({
        query: { type: "inbox", fromEmail: "@example.com" },
      });

      expect(target.getThreadsWithQuery).toHaveBeenCalledTimes(2);
    });

    it("keeps a listing on the source that started it", async () => {
      await seedMailbox(
        [
          { id: "m1", conversationId: "c1", receivedAtMs: 1000 },
          { id: "m2", conversationId: "c2", receivedAtMs: 2000 },
          { id: "m3", conversationId: "c3", receivedAtMs: 3000 },
        ],
        { complete: true },
      );
      const target = providerStub();
      const provider = withStoredMailReads(target, "acc-1", logger);
      const query = { type: "inbox" };

      const first = await provider.getThreadsWithQuery({
        query,
        maxResults: 2,
        messageFormat: "metadata",
      });
      expect(first.nextPageToken).toMatch(/^mailstore\.threads\./);
      const second = await provider.getThreadsWithQuery({
        query,
        maxResults: 2,
        pageToken: first.nextPageToken,
        messageFormat: "metadata",
      });
      expect(second.threads.map((thread) => thread.id)).toEqual(["c1"]);
      expect(second.nextPageToken).toBeUndefined();
      expect(target.getThreadsWithQuery).not.toHaveBeenCalled();

      await provider.getThreadsWithQuery({
        query,
        maxResults: 2,
        pageToken: "provider-token",
        messageFormat: "metadata",
      });
      expect(target.getThreadsWithQuery).toHaveBeenCalledWith(
        expect.objectContaining({ pageToken: "provider-token" }),
      );
    });

    it("never hands a store token to the provider", async () => {
      await seedMailbox(
        [
          { id: "m1", conversationId: "c1", receivedAtMs: 1000 },
          { id: "m2", conversationId: "c2", receivedAtMs: 2000 },
        ],
        { complete: true },
      );
      const target = providerStub();
      const provider = withStoredMailReads(target, "acc-1", logger);
      const first = await provider.getThreadsWithQuery({
        query: { type: "inbox" },
        maxResults: 1,
        messageFormat: "metadata",
      });

      registry.failure = new Error("mailbox unavailable");
      await expect(
        provider.getThreadsWithQuery({
          query: { type: "inbox" },
          maxResults: 1,
          pageToken: first.nextPageToken,
          messageFormat: "metadata",
        }),
      ).rejects.toThrow("can no longer continue");
      expect(target.getThreadsWithQuery).not.toHaveBeenCalled();
    });

    it("asks the provider when the store fails on a first page", async () => {
      registry.failure = new Error("mailbox unavailable");
      const target = providerStub();
      const provider = withStoredMailReads(target, "acc-1", logger);

      const page = await provider.getThreadsWithQuery({
        query: { type: "inbox" },
      });

      expect(target.getThreadsWithQuery).toHaveBeenCalledTimes(1);
      expect(page.nextPageToken).toBe("provider-token");
    });
  });

  describe("message listings", () => {
    it("serves getMessagesWithPagination ids from the store and hydrates them", async () => {
      await seedMailbox(
        [
          {
            id: "m1",
            conversationId: "c1",
            receivedAtMs: 1000,
            from: "ada@example.com",
          },
          {
            id: "m2",
            conversationId: "c2",
            receivedAtMs: 2000,
            from: "bob@example.com",
          },
          {
            id: "m3",
            conversationId: "c3",
            receivedAtMs: 3000,
            from: "ada@example.com",
          },
        ],
        { complete: true },
      );
      const target = providerStub();
      const provider = withStoredMailReads(target, "acc-1", logger);

      const page = await provider.getMessagesWithPagination({
        query: "from:ada@example.com",
        maxResults: 1,
      });

      expect(target.getMessagesWithPagination).not.toHaveBeenCalled();
      expect(page.messages.map((message) => message.id)).toEqual(["m3"]);
      expect(page.nextPageToken).toMatch(/^mailstore\.messages\./);
    });

    it("asks the provider for search strings it cannot translate", async () => {
      await seedMailbox(
        [{ id: "m1", conversationId: "c1", receivedAtMs: 1000 }],
        { complete: true },
      );
      const target = providerStub();
      const provider = withStoredMailReads(target, "acc-1", logger);

      await provider.getMessagesWithPagination({
        query: "invoice older_than:1y",
      });

      expect(target.getMessagesWithPagination).toHaveBeenCalledTimes(1);
    });

    it("serves sent message ids and caps hydrated listings like Gmail", async () => {
      await seedMailbox(
        [
          {
            id: "s1",
            conversationId: "c1",
            receivedAtMs: 1000,
            roles: ["sent"],
          },
          { id: "m2", conversationId: "c2", receivedAtMs: 2000 },
        ],
        { complete: true },
      );
      const target = providerStub();
      const provider = withStoredMailReads(target, "acc-1", logger);

      const ids = await provider.getSentMessageIds({ maxResults: 10 });
      const sent = await provider.getSentMessages(50);

      expect(ids.messages).toEqual([{ id: "s1", threadId: "c1" }]);
      expect(sent.map((message) => message.id)).toEqual(["s1"]);
      expect(target.getSentMessageIds).not.toHaveBeenCalled();
      expect(target.getSentMessages).not.toHaveBeenCalled();
    });
  });

  describe("counts and lookups", () => {
    it("answers getInboxStats from stored messages", async () => {
      await seedMailbox(
        [
          { id: "m1", conversationId: "c1", receivedAtMs: 1000, read: true },
          { id: "m2", conversationId: "c1", receivedAtMs: 2000 },
        ],
        { complete: true },
      );
      const target = providerStub();
      const provider = withStoredMailReads(target, "acc-1", logger);

      expect(await provider.getInboxStats()).toEqual({ total: 2, unread: 1 });
      expect(target.getInboxStats).not.toHaveBeenCalled();
    });

    it("trusts a stored match without complete coverage but not a miss", async () => {
      await seedMailbox(
        [
          {
            id: "m1",
            conversationId: "c1",
            receivedAtMs: 1000,
            from: "ada@example.com",
          },
        ],
        { complete: false },
      );
      const target = providerStub();
      const provider = withStoredMailReads(target, "acc-1", logger);

      const known = await provider.hasPreviousCommunicationsWithSenderOrDomain({
        from: "ada@example.com",
        date: new Date(5000),
        messageId: "current",
      });
      const unknown =
        await provider.hasPreviousCommunicationsWithSenderOrDomain({
          from: "eve@other.org",
          date: new Date(5000),
          messageId: "current",
        });

      expect(known).toBe(true);
      expect(unknown).toBe(false);
      expect(
        target.hasPreviousCommunicationsWithSenderOrDomain,
      ).toHaveBeenCalledTimes(1);
    });

    it("answers a miss from the store once coverage is complete", async () => {
      await seedMailbox(
        [{ id: "m1", conversationId: "c1", receivedAtMs: 1000 }],
        { complete: true },
      );
      const target = providerStub();
      const provider = withStoredMailReads(target, "acc-1", logger);

      expect(await provider.checkIfReplySent("ada@example.com")).toBe(false);
      expect(await provider.countReceivedMessages("ada@example.com", 5)).toBe(
        1,
      );
      expect(target.checkIfReplySent).not.toHaveBeenCalled();
      expect(target.countReceivedMessages).not.toHaveBeenCalled();
    });
  });

  it("leaves Outlook providers untouched", async () => {
    await seedMailbox(
      [{ id: "m1", conversationId: "c1", receivedAtMs: 1000 }],
      { complete: true },
    );
    const target = { ...providerStub(), name: "microsoft" } as EmailProvider;
    const provider = withStoredMailReads(target, "acc-1", logger);

    await provider.getInboxStats();

    expect(target.getInboxStats).toHaveBeenCalledTimes(1);
  });
});

function providerStub() {
  return {
    name: "google",
    getThreadsWithQuery: vi.fn(async () => ({
      threads: [],
      nextPageToken: "provider-token",
    })),
    getMessagesWithPagination: vi.fn(async () => ({ messages: [] })),
    getMessagesBatch: vi.fn(async (ids: string[]) =>
      ids.map(
        (id) =>
          ({
            id,
            threadId: `thread-${id}`,
            textPlain: `body of ${id}`,
            headers: {},
          }) as unknown as ParsedMessage,
      ),
    ),
    getSentMessages: vi.fn(async () => []),
    getSentMessageIds: vi.fn(async () => ({ messages: [] })),
    getInboxStats: vi.fn(async () => ({ total: 99, unread: 9 })),
    hasPreviousCommunicationsWithSenderOrDomain: vi.fn(async () => false),
    checkIfReplySent: vi.fn(async () => true),
    countReceivedMessages: vi.fn(async () => 42),
  } as unknown as EmailProvider & Record<string, ReturnType<typeof vi.fn>>;
}

async function seedMailbox(
  messages: Seed[],
  { complete, syncedAtMs }: { complete: boolean; syncedAtMs?: number },
) {
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
        cc: [],
        receivedAtMs: message.receivedAtMs,
        read: message.read ?? false,
        starred: false,
        folderId: null,
        labelIds: [],
        categoryIds: [],
        roles: message.roles ?? ["inbox"],
        hasAttachments: false,
        headers: { messageId: `<${message.id}@example.com>` },
      },
    })),
    bodies: [],
  });
  if (complete) {
    await driver.write(async (tx) => {
      await tx.execute(
        `INSERT INTO coverage(account_id, scope_id, metadata, content, indexed_content, last_completed_sync_at_ms)
         VALUES ('acc-1', 'account:all', 'complete', 'partial', 'partial', ?)`,
        [syncedAtMs ?? Date.now()],
      );
    });
  }
  registry.driver = driver;
}
