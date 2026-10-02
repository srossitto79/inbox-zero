import "server-only";
import { nodeBodyCodec } from "@inboxzero/mail-sqlite/node";
import {
  readStoredMessages,
  type StoredMessage,
} from "@inboxzero/mail-sqlite/stored-messages";
import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import { conversationMessageToParsed } from "@/utils/mail-engine/conversation-thread";
import { getServerMailboxDriver } from "@/utils/mail-engine/server/engine-registry";
import { storedThreadReads } from "@/utils/mail-engine/server/stored-thread-reads";
import type { ParsedMessage } from "@/utils/types";

/**
 * Serves message reads from the server mailbox when it holds the message with
 * its body and headers, and asks the provider for the rest. Searches and
 * everything else still go to the provider.
 */
export function withStoredMailReads(
  provider: EmailProvider,
  emailAccountId: string,
  logger: Logger,
): EmailProvider {
  const readMany = async (
    messageIds: string[],
    fetchMissing: (missingIds: string[]) => Promise<ParsedMessage[]>,
  ) => {
    const stored = await readUsableMessages(emailAccountId, messageIds, logger);
    const missingIds = messageIds.filter((id) => !stored.has(id));
    const fetched = missingIds.length ? await fetchMissing(missingIds) : [];
    const fetchedById = new Map(
      fetched.map((message) => [message.id, message]),
    );
    logger.trace("Served message reads from the server mailbox", {
      stored: stored.size,
      fetched: fetched.length,
    });
    return messageIds.flatMap((id) => {
      const message = stored.get(id) ?? fetchedById.get(id);
      return message ? [message] : [];
    });
  };

  const threadReads = storedThreadReads(provider, emailAccountId, logger);

  return new Proxy(provider, {
    get(target, property, receiver) {
      if (Object.hasOwn(threadReads, property)) {
        return threadReads[property as keyof typeof threadReads];
      }
      if (property === "getMessage") {
        return async (
          messageId: string,
          options?: Parameters<EmailProvider["getMessage"]>[1],
        ) => {
          // Calendar content is not kept in the mailbox store.
          if (options?.includeCalendarContent) {
            return target.getMessage(messageId, options);
          }
          const stored = await readUsableMessages(
            emailAccountId,
            [messageId],
            logger,
          );
          return stored.get(messageId) ?? target.getMessage(messageId, options);
        };
      }
      if (property === "getMessagesBatch") {
        return (messageIds: string[]) =>
          readMany(messageIds, (missing) => target.getMessagesBatch(missing));
      }
      if (property === "getPreviousConversationMessages") {
        return (messageIds: string[]) =>
          readMany(messageIds, (missing) =>
            target.getPreviousConversationMessages(missing),
          );
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

async function readUsableMessages(
  emailAccountId: string,
  messageIds: string[],
  logger: Logger,
) {
  const usable = new Map<string, ParsedMessage>();
  if (messageIds.length === 0) return usable;
  try {
    const driver = await getServerMailboxDriver(emailAccountId);
    const stored = await readStoredMessages(driver, nodeBodyCodec, {
      accountId: emailAccountId,
      messageIds,
    });
    for (const entry of stored) {
      const parsed = storedMessageToParsed(entry);
      if (parsed) usable.set(parsed.id, parsed);
    }
  } catch (error) {
    // The provider still answers; a store problem must not fail the caller.
    logger.warn("Could not read the server mailbox", { error });
  }
  return usable;
}

/**
 * Null unless the message was stored with its headers and body: older rows
 * predate stored headers, and a message without a body is only partly known.
 */
export function storedMessageToParsed({
  message,
  content,
}: StoredMessage): ParsedMessage | null {
  if (!message.headers || !content) return null;
  const parsed = conversationMessageToParsed(
    {
      key: {
        accountId: message.accountId,
        conversationId: message.conversationId,
      },
      messages: [],
    },
    {
      key: { accountId: message.accountId, messageId: message.messageId },
      metadata: message,
      content: { status: "available", ...content },
      pendingOperationIds: [],
    },
  );
  const { headers } = message;
  return {
    ...parsed,
    historyId: message.version ?? "",
    headers: {
      ...parsed.headers,
      "message-id": headers.messageId,
      references: headers.references,
      "in-reply-to": headers.inReplyTo,
      "reply-to": headers.replyTo,
      bcc: headers.bcc,
      "list-unsubscribe": headers.listUnsubscribe,
      "list-unsubscribe-post": headers.listUnsubscribePost,
    },
  };
}
