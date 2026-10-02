import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredMessage } from "@inboxzero/mail-sqlite/stored-messages";
import type { EmailProvider } from "@/utils/email/types";
import { createScopedLogger } from "@/utils/logger";
import { withStoredMailReads } from "@/utils/mail-engine/server/stored-reads";
import type { ParsedMessage } from "@/utils/types";

const store = vi.hoisted(() => ({
  conversation: [] as StoredMessage[],
  effective: [] as Array<Record<string, unknown>>,
  byReference: [] as Array<Record<string, unknown>>,
  fail: false,
}));

vi.mock("@/utils/mail-engine/server/engine-registry", () => ({
  getServerMailboxDriver: async () => {
    if (store.fail) throw new Error("store unavailable");
    return {
      read: async (
        run: (tx: {
          query: (sql: string) => Promise<Array<Record<string, unknown>>>;
        }) => unknown,
      ) =>
        run({
          query: async (sql: string) =>
            sql.includes("effective_messages")
              ? store.effective
              : store.byReference,
        }),
    };
  },
}));
vi.mock("@inboxzero/mail-sqlite/stored-messages", () => ({
  readStoredConversation: async () => store.conversation,
  readStoredMessages: async (
    _driver: unknown,
    _codec: unknown,
    input: { messageIds: string[] },
  ) =>
    store.conversation.filter((entry) =>
      input.messageIds.includes(entry.message.messageId),
    ),
}));

const logger = createScopedLogger("stored-thread-reads-test");

describe("stored thread reads", () => {
  beforeEach(() => {
    store.conversation = [];
    store.effective = [];
    store.byReference = [];
    store.fail = false;
  });

  it("serves getThread from the store, oldest first and without drafts", async () => {
    store.conversation = [
      storedMessage("m1"),
      storedMessage("m2", { inReplyTo: "<m1@example.com>" }),
      storedMessage("d1", {
        roles: ["draft"],
        inReplyTo: "<m2@example.com>",
      }),
    ];
    const getThread = vi.fn();
    const provider = withStoredMailReads(
      { getThread } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    const thread = await provider.getThread("c1");

    expect(getThread).not.toHaveBeenCalled();
    expect(thread.id).toBe("c1");
    expect(thread.messages.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(thread.snippet).toBe("hi");

    const withDrafts = await provider.getThread("c1", { includeDrafts: true });
    expect(withDrafts.messages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "d1",
    ]);
  });

  it("applies pending local operations to labels", async () => {
    store.conversation = [storedMessage("m1")];
    store.effective = [
      {
        message_id: "m1",
        read: 1,
        starred: 0,
        folder_id: null,
        label_ids_json: "[]",
        roles_json: '["trash"]',
      },
    ];
    const provider = withStoredMailReads(
      {} as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    const [message] = await provider.getThreadMessages("c1");

    expect(message.labelIds).toEqual(["TRASH"]);
  });

  it("filters getThreadMessagesInInbox by the inbox label", async () => {
    store.conversation = [
      storedMessage("m1", { roles: ["sent"] }),
      storedMessage("m2", { inReplyTo: "<m1@example.com>" }),
    ];
    const provider = withStoredMailReads(
      {} as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    const messages = await provider.getThreadMessagesInInbox("c1");

    expect(messages.map((message) => message.id)).toEqual(["m2"]);
  });

  it("returns the latest message of a stored thread", async () => {
    store.conversation = [
      storedMessage("m1", { receivedAtMs: 1000 }),
      storedMessage("m2", {
        receivedAtMs: 2000,
        inReplyTo: "<m1@example.com>",
      }),
    ];
    const getLatestMessageInThread = vi.fn();
    const provider = withStoredMailReads(
      { getLatestMessageInThread } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    const latest = await provider.getLatestMessageInThread("c1");

    expect(latest?.id).toBe("m2");
    expect(getLatestMessageInThread).not.toHaveBeenCalled();
  });

  it("asks the provider for the whole thread when a message has no body", async () => {
    store.conversation = [
      storedMessage("m1"),
      storedMessage("m2", { body: false, inReplyTo: "<m1@example.com>" }),
    ];
    const providerThread = { id: "c1", messages: [], snippet: "" };
    const getThread = vi.fn(async () => providerThread);
    const provider = withStoredMailReads(
      { getThread } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    await expect(provider.getThread("c1")).resolves.toBe(providerThread);
    expect(getThread).toHaveBeenCalledWith("c1", undefined);
  });

  it("asks the provider when an older message of the thread is not stored", async () => {
    store.conversation = [
      storedMessage("m2", { inReplyTo: "<m1@example.com>" }),
    ];
    const getThreadMessages = vi.fn(async () => [] as ParsedMessage[]);
    const provider = withStoredMailReads(
      { getThreadMessages } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    await provider.getThreadMessages("c1");

    expect(getThreadMessages).toHaveBeenCalledWith("c1");
  });

  it("asks the provider when the thread is not stored", async () => {
    const getThreadMessagesInInbox = vi.fn(async () => [] as ParsedMessage[]);
    const provider = withStoredMailReads(
      { getThreadMessagesInInbox } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    await provider.getThreadMessagesInInbox("c1");

    expect(getThreadMessagesInInbox).toHaveBeenCalledWith("c1");
  });

  it("asks the provider when the store fails", async () => {
    store.fail = true;
    const providerThread = { id: "c1", messages: [], snippet: "" };
    const getThread = vi.fn(async () => providerThread);
    const provider = withStoredMailReads(
      { getThread } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    await expect(provider.getThread("c1")).resolves.toBe(providerThread);
  });

  it("finds the original message by its Message-ID header", async () => {
    store.conversation = [storedMessage("m1")];
    store.byReference = [{ message_id: "m1" }];
    const getOriginalMessage = vi.fn();
    const provider = withStoredMailReads(
      { getOriginalMessage } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    const message = await provider.getOriginalMessage("<m1@example.com>");

    expect(message?.id).toBe("m1");
    expect(getOriginalMessage).not.toHaveBeenCalled();
  });

  it("asks the provider for an original message the store does not hold", async () => {
    const getOriginalMessage = vi.fn(async () => null);
    const provider = withStoredMailReads(
      { getOriginalMessage } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    await provider.getOriginalMessage("<unknown@example.com>");

    expect(getOriginalMessage).toHaveBeenCalledWith("<unknown@example.com>");
  });
});

function storedMessage(
  messageId: string,
  options: {
    body?: boolean;
    inReplyTo?: string;
    receivedAtMs?: number;
    roles?: StoredMessage["message"]["roles"];
  } = {},
): StoredMessage {
  return {
    message: {
      accountId: "acc-1",
      messageId,
      conversationId: "c1",
      version: "42",
      deleted: false,
      subject: "Hello",
      preview: "hi",
      from: "Ada <ada@example.com>",
      to: ["me@example.com"],
      cc: [],
      receivedAtMs: options.receivedAtMs ?? 1_700_000_000_000,
      read: false,
      starred: false,
      folderId: null,
      labelIds: [],
      categoryIds: [],
      roles: options.roles ?? ["inbox"],
      hasAttachments: false,
      headers: {
        messageId: `<${messageId}@example.com>`,
        inReplyTo: options.inReplyTo,
      },
    },
    content:
      options.body === false
        ? null
        : {
            html: "<p>hi</p>",
            text: null,
            attachments: [],
            isMeetingInvitation: false,
          },
  };
}
