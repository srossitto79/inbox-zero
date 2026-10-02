import "server-only";
import type { SqliteDriver } from "@inboxzero/mail-sqlite/driver";
import { nodeBodyCodec } from "@inboxzero/mail-sqlite/node";
import {
  readStoredConversation,
  readStoredMessages,
  type StoredMessage,
} from "@inboxzero/mail-sqlite/stored-messages";
import { getLatestNonDraftMessage } from "@/utils/email/latest-message";
import { getMessageTimestamp } from "@/utils/email/message-timestamp";
import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import { getServerMailboxDriver } from "@/utils/mail-engine/server/engine-registry";
import { storedMessageToParsed } from "@/utils/mail-engine/server/stored-reads";
import type { ParsedMessage } from "@/utils/types";

type ThreadReads = Pick<
  EmailProvider,
  | "getThread"
  | "getThreadMessages"
  | "getThreadMessagesInInbox"
  | "getLatestMessageInThread"
  | "getOriginalMessage"
  | "getMessageByRfc822MessageId"
>;

/**
 * Thread-shaped reads served from the server mailbox when the whole
 * conversation is stored with headers and bodies, and by the provider
 * otherwise. A thread is never answered partly: if any message is missing or
 * unusable the provider gets the whole call.
 *
 * getLatestMessageFromThreadSnapshot needs no override: both providers
 * implement it through getLatestMessageInThread, which the proxy intercepts.
 */
export function storedThreadReads(
  provider: EmailProvider,
  emailAccountId: string,
  logger: Logger,
): ThreadReads {
  const readThread = (threadId: string, includeDrafts = false) =>
    readStoredThread(emailAccountId, threadId, includeDrafts, logger);

  return {
    getThread: async (threadId, options) => {
      const messages = await readThread(threadId, options?.includeDrafts);
      if (!messages) return provider.getThread(threadId, options);
      return {
        id: threadId,
        messages,
        snippet: messages.at(-1)?.snippet ?? "",
      };
    },
    getThreadMessages: async (threadId) =>
      (await readThread(threadId)) ?? provider.getThreadMessages(threadId),
    getThreadMessagesInInbox: async (threadId) => {
      const messages = await readThread(threadId);
      if (!messages) return provider.getThreadMessagesInInbox(threadId);
      return messages.filter((message) => message.labelIds?.includes("INBOX"));
    },
    getLatestMessageInThread: async (threadId) => {
      const messages = await readThread(threadId);
      // A thread of drafts only is rare enough to leave to the provider.
      if (!messages?.length) return provider.getLatestMessageInThread(threadId);
      return getLatestNonDraftMessage({
        messages,
        getTimestamp: getMessageTimestamp,
      });
    },
    // Gmail passes an RFC 822 Message-ID, Outlook a message id; either can
    // name a stored message.
    getOriginalMessage: async (originalMessageId) => {
      if (!originalMessageId) return null;
      return (
        (await readStoredByReference(
          emailAccountId,
          originalMessageId,
          logger,
        )) ?? provider.getOriginalMessage(originalMessageId)
      );
    },
    getMessageByRfc822MessageId: async (rfc822MessageId) =>
      (await readStoredByReference(emailAccountId, rfc822MessageId, logger)) ??
      provider.getMessageByRfc822MessageId(rfc822MessageId),
  };
}

async function readStoredThread(
  emailAccountId: string,
  threadId: string,
  includeDrafts: boolean,
  logger: Logger,
): Promise<ParsedMessage[] | null> {
  try {
    const driver = await getServerMailboxDriver(emailAccountId);
    const [stored, effective] = await Promise.all([
      readStoredConversation(driver, nodeBodyCodec, {
        accountId: emailAccountId,
        conversationId: threadId,
      }),
      readEffectiveMetadata(driver, emailAccountId, threadId),
    ]);
    if (stored.length === 0) return null;

    const messages: ParsedMessage[] = [];
    for (const entry of stored) {
      const current = withEffectiveMetadata(entry, effective);
      if (current.message.roles.includes("draft") && !includeDrafts) continue;
      const parsed = storedMessageToParsed(current);
      if (!parsed) return null;
      messages.push(parsed);
    }
    if (!hasEveryParent(stored)) return null;
    logger.trace("Served thread read from the server mailbox", {
      messages: messages.length,
    });
    return messages;
  } catch (error) {
    // The provider still answers; a store problem must not fail the caller.
    logger.warn("Could not read the thread from the server mailbox", { error });
    return null;
  }
}

async function readStoredByReference(
  emailAccountId: string,
  reference: string,
  logger: Logger,
): Promise<ParsedMessage | null> {
  try {
    const driver = await getServerMailboxDriver(emailAccountId);
    const bare = reference.replace(/[<>]/g, "").trim();
    const rows = await driver.read((tx) =>
      tx.query(
        `SELECT message_id FROM messages
         WHERE account_id = ? AND deleted = 0
           AND (message_id = ? OR json_extract(headers_json, '$.messageId') IN (?, ?))
         LIMIT 1`,
        [emailAccountId, reference, bare, `<${bare}>`],
      ),
    );
    if (rows.length === 0) return null;
    const [entry] = await readStoredMessages(driver, nodeBodyCodec, {
      accountId: emailAccountId,
      messageIds: [String(rows[0].message_id)],
    });
    return entry ? storedMessageToParsed(entry) : null;
  } catch (error) {
    logger.warn("Could not look the message up in the server mailbox", {
      error,
    });
    return null;
  }
}

type EffectiveMetadata = Map<
  string,
  Pick<StoredMessage["message"], "read" | "starred" | "roles" | "labelIds"> & {
    folderId: string | null;
  }
>;

/** Labels and read state with the operations still waiting for the provider applied. */
async function readEffectiveMetadata(
  driver: SqliteDriver,
  accountId: string,
  conversationId: string,
): Promise<EffectiveMetadata> {
  const rows = await driver.read((tx) =>
    tx.query(
      `SELECT message_id, read, starred, folder_id, label_ids_json, roles_json
       FROM effective_messages WHERE account_id = ? AND conversation_id = ?`,
      [accountId, conversationId],
    ),
  );
  return new Map(
    rows.map((row) => [
      String(row.message_id),
      {
        read: Number(row.read) === 1,
        starred: Number(row.starred) === 1,
        folderId: row.folder_id == null ? null : String(row.folder_id),
        labelIds: JSON.parse(String(row.label_ids_json)),
        roles: JSON.parse(String(row.roles_json)),
      },
    ]),
  );
}

function withEffectiveMetadata(
  entry: StoredMessage,
  effective: EffectiveMetadata,
): StoredMessage {
  const current = effective.get(entry.message.messageId);
  return current
    ? { ...entry, message: { ...entry.message, ...current } }
    : entry;
}

/**
 * The mailbox can hold only the newer part of a conversation. A reply whose
 * parent is not stored shows that older messages are missing.
 */
function hasEveryParent(stored: StoredMessage[]) {
  const known = new Set(
    stored.flatMap(({ message }) =>
      message.headers?.messageId ? [message.headers.messageId.trim()] : [],
    ),
  );
  return stored.every(({ message }) => {
    const parent = parentMessageId(message.headers);
    return !parent || known.has(parent);
  });
}

function parentMessageId(headers: StoredMessage["message"]["headers"]) {
  if (headers?.inReplyTo?.trim()) return headers.inReplyTo.trim();
  return headers?.references?.trim().split(/\s+/).at(-1);
}
