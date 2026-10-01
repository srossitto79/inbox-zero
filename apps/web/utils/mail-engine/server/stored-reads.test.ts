import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredMessage } from "@inboxzero/mail-sqlite/stored-messages";
import type { EmailProvider } from "@/utils/email/types";
import { createScopedLogger } from "@/utils/logger";
import {
  storedMessageToParsed,
  withStoredMailReads,
} from "@/utils/mail-engine/server/stored-reads";
import type { ParsedMessage } from "@/utils/types";

const stored = vi.hoisted(() => ({ messages: [] as StoredMessage[] }));

vi.mock("@/utils/mail-engine/server/engine-registry", () => ({
  getServerMailboxDriver: async () => ({}),
}));
vi.mock("@inboxzero/mail-sqlite/stored-messages", () => ({
  readStoredMessages: async (
    _driver: unknown,
    _codec: unknown,
    input: { messageIds: string[] },
  ) =>
    stored.messages.filter((entry) =>
      input.messageIds.includes(entry.message.messageId),
    ),
}));

const logger = createScopedLogger("stored-reads-test");

describe("withStoredMailReads", () => {
  beforeEach(() => {
    stored.messages = [];
  });

  it("answers getMessage from the store without asking the provider", async () => {
    stored.messages = [storedMessage("m1")];
    const getMessage = vi.fn();
    const provider = withStoredMailReads(
      { getMessage } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    const message = await provider.getMessage("m1");

    expect(getMessage).not.toHaveBeenCalled();
    expect(message.headers).toMatchObject({
      "message-id": "<m1@example.com>",
      "in-reply-to": "<root@example.com>",
      "list-unsubscribe": "<mailto:u@example.com>",
    });
    expect(message.textHtml).toBe("<p>hi</p>");
    expect(message.labelIds).toEqual(
      expect.arrayContaining(["INBOX", "UNREAD"]),
    );
  });

  it("asks the provider for messages the store cannot answer, keeping order", async () => {
    stored.messages = [
      storedMessage("m2"),
      storedMessage("m3", { body: false }),
    ];
    const getMessagesBatch = vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id }) as ParsedMessage),
    );
    const provider = withStoredMailReads(
      { getMessagesBatch } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    const messages = await provider.getMessagesBatch(["m1", "m2", "m3"]);

    expect(getMessagesBatch).toHaveBeenCalledWith(["m1", "m3"]);
    expect(messages.map((message) => message.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("goes to the provider when calendar content is requested", async () => {
    stored.messages = [storedMessage("m1")];
    const getMessage = vi.fn(async () => ({ id: "m1" }) as ParsedMessage);
    const provider = withStoredMailReads(
      { getMessage } as unknown as EmailProvider,
      "acc-1",
      logger,
    );

    await provider.getMessage("m1", { includeCalendarContent: true });

    expect(getMessage).toHaveBeenCalledWith("m1", {
      includeCalendarContent: true,
    });
  });
});

describe("storedMessageToParsed", () => {
  it("skips messages stored before headers were kept", () => {
    expect(
      storedMessageToParsed(storedMessage("m1", { headers: false })),
    ).toBeNull();
  });
});

function storedMessage(
  messageId: string,
  options: { body?: boolean; headers?: boolean } = {},
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
      receivedAtMs: 1_700_000_000_000,
      read: false,
      starred: false,
      folderId: null,
      labelIds: [],
      categoryIds: [],
      roles: ["inbox"],
      hasAttachments: false,
      headers:
        options.headers === false
          ? null
          : {
              messageId: `<${messageId}@example.com>`,
              inReplyTo: "<root@example.com>",
              listUnsubscribe: "<mailto:u@example.com>",
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
