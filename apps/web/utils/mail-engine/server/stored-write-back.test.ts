import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqliteDriver } from "@inboxzero/mail-sqlite/driver";
import {
  createNodeSqliteDriver,
  nodeBodyCodec,
} from "@inboxzero/mail-sqlite/node";
import { readStoredMessages } from "@inboxzero/mail-sqlite/stored-messages";
import { createSqliteMailStore } from "@inboxzero/mail-sqlite/store";
import type { EmailProvider } from "@/utils/email/types";
import { createScopedLogger } from "@/utils/logger";
import { withStoredMailReads } from "@/utils/mail-engine/server/stored-reads";
import type { ParsedMessage } from "@/utils/types";

const registry = vi.hoisted(() => ({
  driver: null as SqliteDriver | null,
  store: null as unknown,
  storeFailure: null as Error | null,
}));

vi.mock("@/utils/mail-engine/server/engine-registry", () => ({
  getServerMailboxDriver: async () => registry.driver,
  getServerMailStore: async () => {
    if (registry.storeFailure) throw registry.storeFailure;
    return {
      store: registry.store,
      session: { accountId: "acc-1", generation: "g1" },
    };
  },
}));

const logger = createScopedLogger("stored-write-back-test");
const session = { accountId: "acc-1", generation: "g1" };

describe("write-back of provider reads", () => {
  beforeEach(async () => {
    registry.storeFailure = null;
    const driver = createNodeSqliteDriver();
    const store = await createSqliteMailStore(driver, {
      bodyCodec: nodeBodyCodec,
    });
    await store.ensureAccount({
      accountId: "acc-1",
      provider: "google",
      generation: "g1",
    });
    registry.driver = driver;
    registry.store = store;
  });

  it("serves a message the provider answered from the store the second time", async () => {
    const getMessage = vi.fn(async () => providerMessage("m1"));
    const provider = withStoredMailReads(
      { name: "google", getMessage } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    const first = await provider.getMessage("m1");
    await waitForUsable("m1");
    const second = await provider.getMessage("m1");

    expect(getMessage).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({
      id: "m1",
      threadId: "c1",
      subject: "Subject m1",
      textHtml: first.textHtml,
      historyId: "5",
      labelIds: expect.arrayContaining(["INBOX", "UNREAD"]),
      headers: expect.objectContaining({ "message-id": "<m1@example.com>" }),
    });
  });

  it("serves a whole thread from the store after one provider fetch", async () => {
    const thread = {
      id: "c1",
      snippet: "",
      messages: [
        providerMessage("m1"),
        providerMessage("m2", { inReplyTo: "<m1@example.com>" }),
      ],
    };
    const getThread = vi.fn(async () => thread);
    const provider = withStoredMailReads(
      { name: "google", getThread } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    await provider.getThread("c1");
    await waitForUsable("m1", "m2");
    const again = await provider.getThread("c1");

    expect(getThread).toHaveBeenCalledTimes(1);
    expect(again.messages.map((message) => message.id)).toEqual(["m1", "m2"]);
  });

  it("stores only the messages a batch read had to fetch", async () => {
    const getMessagesBatch = vi.fn(async (ids: string[]) =>
      ids.map((id) => providerMessage(id)),
    );
    const provider = withStoredMailReads(
      { name: "google", getMessagesBatch } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    await provider.getMessagesBatch(["m1", "m2"]);
    await waitForUsable("m1", "m2");
    await provider.getMessagesBatch(["m1", "m2", "m3"]);

    expect(getMessagesBatch).toHaveBeenNthCalledWith(1, ["m1", "m2"]);
    expect(getMessagesBatch).toHaveBeenNthCalledWith(2, ["m3"]);
  });

  it("upgrades a metadata-only row to a usable one", async () => {
    await seedMetadataOnly("m1", "1");
    expect(await usableIds("m1")).toEqual([]);
    const getMessage = vi.fn(async () =>
      providerMessage("m1", { version: "1" }),
    );
    const provider = withStoredMailReads(
      { name: "google", getMessage } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    await provider.getMessage("m1");
    await waitForUsable("m1");
    await provider.getMessage("m1");

    expect(getMessage).toHaveBeenCalledTimes(1);
  });

  it("does not replace a newer stored row with older provider data", async () => {
    await seedMetadataOnly("m1", "9");
    const getMessage = vi.fn(async () =>
      providerMessage("m1", { version: "5" }),
    );
    const provider = withStoredMailReads(
      { name: "google", getMessage } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    await provider.getMessage("m1");
    // The write is a no-op, so there is nothing to wait for; let it run.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const [entry] = await readStoredMessages(registry.driver!, nodeBodyCodec, {
      accountId: "acc-1",
      messageIds: ["m1"],
    });
    expect(entry.message.version).toBe("9");
    expect(entry.content).toBeNull();
  });

  it("leaves a complete stored row alone", async () => {
    const getMessage = vi.fn(async () =>
      providerMessage("m1", { version: "5" }),
    );
    const provider = withStoredMailReads(
      { name: "google", getMessage } as unknown as EmailProvider,
      "acc-1",
      logger,
    );
    await provider.getMessage("m1");
    await waitForUsable("m1");
    const applyHydration = vi.spyOn(
      registry.store as { applyHydration: () => unknown },
      "applyHydration",
    );

    const messages = await withStoredMailReads(
      {
        name: "google",
        getThreadMessages: async () => [
          providerMessage("m1", { version: "6", labels: ["INBOX"] }),
        ],
      } as unknown as EmailProvider,
      "acc-1",
      logger,
    ).getThreadMessages("c9");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(messages).toHaveLength(1);
    expect(applyHydration).not.toHaveBeenCalled();
  });

  it("does not mark coverage complete", async () => {
    const provider = withStoredMailReads(
      {
        name: "google",
        getMessage: async () => providerMessage("m1"),
      } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    await provider.getMessage("m1");
    await waitForUsable("m1");

    const coverage = await registry.driver!.read((tx) =>
      tx.query("SELECT * FROM coverage WHERE account_id = 'acc-1'"),
    );
    expect(coverage).toEqual([]);
  });

  it("does not store messages parsed without headers", async () => {
    const partial = { ...providerMessage("m1"), headers: {} } as ParsedMessage;
    const provider = withStoredMailReads(
      {
        name: "google",
        getMessage: async () => partial,
      } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    await provider.getMessage("m1");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const stored = await readStoredMessages(registry.driver!, nodeBodyCodec, {
      accountId: "acc-1",
      messageIds: ["m1"],
    });
    expect(stored).toEqual([]);
  });

  it("does not store an invitation whose parts carry no body", async () => {
    const partial = {
      ...providerMessage("m1"),
      textHtml: undefined,
      textPlain: undefined,
      isMeetingInvitation: true,
    } as ParsedMessage;
    const provider = withStoredMailReads(
      {
        name: "google",
        getMessage: async () => partial,
      } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    await provider.getMessage("m1");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const stored = await readStoredMessages(registry.driver!, nodeBodyCodec, {
      accountId: "acc-1",
      messageIds: ["m1"],
    });
    expect(stored).toEqual([]);
  });

  it("answers the read when the write fails", async () => {
    registry.storeFailure = new Error("store unavailable");
    const getMessage = vi.fn(async () => providerMessage("m1"));
    const provider = withStoredMailReads(
      { name: "google", getMessage } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    const message = await provider.getMessage("m1");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(message.id).toBe("m1");
  });

  it("answers the read when the store rejects the write", async () => {
    vi.spyOn(
      registry.store as { applyHydration: () => unknown },
      "applyHydration",
    ).mockRejectedValue(new Error("disk full"));
    const provider = withStoredMailReads(
      {
        name: "google",
        getMessage: async () => providerMessage("m1"),
      } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    await expect(provider.getMessage("m1")).resolves.toMatchObject({
      id: "m1",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("stores full threads listed by the provider, not metadata lists", async () => {
    const getThreadsWithQuery = vi.fn(async () => ({
      threads: [
        {
          id: "c1",
          snippet: "",
          messages: [providerMessage("m1")],
        },
      ],
    }));
    const provider = withStoredMailReads(
      { name: "google", getThreadsWithQuery } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    await provider.getThreadsWithQuery({
      query: { type: "inbox" },
      messageFormat: "metadata",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await usableIds("m1")).toEqual([]);

    await provider.getThreadsWithQuery({ query: { type: "inbox" } });
    await waitForUsable("m1");
  });
});

async function usableIds(...ids: string[]) {
  const stored = await readStoredMessages(registry.driver!, nodeBodyCodec, {
    accountId: "acc-1",
    messageIds: ids,
  });
  return stored
    .filter((entry) => entry.message.headers && entry.content)
    .map((entry) => entry.message.messageId);
}

function waitForUsable(...ids: string[]) {
  return vi.waitFor(
    async () => {
      expect((await usableIds(...ids)).sort()).toEqual([...ids].sort());
    },
    { timeout: 3000, interval: 20 },
  );
}

async function seedMetadataOnly(
  id: string,
  version: string,
  { read = true }: { read?: boolean } = {},
) {
  await (
    registry.store as {
      applyHydration: (input: unknown) => Promise<unknown>;
    }
  ).applyHydration({
    session,
    requestId: "seed",
    changes: [
      {
        kind: "message_patch",
        key: { accountId: "acc-1", messageId: id },
        reference: {
          provider: "google",
          messageId: id,
          conversationId: "c1",
          version,
        },
        fields: {
          subject: "Old",
          preview: "",
          from: "ada@example.com",
          to: ["me@example.com"],
          cc: [],
          receivedAtMs: 1000,
          read,
          starred: false,
          folderId: null,
          labelIds: [],
          categoryIds: [],
          roles: ["inbox"],
          hasAttachments: false,
          headers: { messageId: `<${id}@example.com>` },
        },
      },
    ],
    bodies: [],
  });
}

function providerMessage(
  id: string,
  options: { version?: string; inReplyTo?: string; labels?: string[] } = {},
): ParsedMessage {
  return {
    id,
    threadId: "c1",
    historyId: options.version ?? "5",
    snippet: `snippet ${id}`,
    subject: `Subject ${id}`,
    date: "Thu, 01 Jan 2026 00:00:00 +0000",
    internalDate: "1767225600000",
    labelIds: options.labels ?? ["INBOX", "UNREAD"],
    textPlain: `body of ${id}`,
    textHtml: `<p>body of ${id}</p>`,
    attachments: [],
    inline: [],
    headers: {
      from: "ada@example.com",
      to: "me@example.com",
      subject: `Subject ${id}`,
      date: "Thu, 01 Jan 2026 00:00:00 +0000",
      "message-id": `<${id}@example.com>`,
      ...(options.inReplyTo ? { "in-reply-to": options.inReplyTo } : {}),
    },
  };
}
