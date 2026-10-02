import "server-only";
import { randomUUID } from "node:crypto";
import { nodeBodyCodec } from "@inboxzero/mail-sqlite/node";
import {
  readStoredMessages,
  type StoredMessage,
} from "@inboxzero/mail-sqlite/stored-messages";
import { afterResponseOrNow } from "@/utils/after-response";
import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import {
  hydratedBodies,
  parsedMessagePatch,
} from "@/utils/mail-api/observations";
import {
  getServerMailboxDriver,
  getServerMailStore,
} from "@/utils/mail-engine/server/engine-registry";
import type { ParsedMessage } from "@/utils/types";

const WRITE_BATCH_SIZE = 50;

/**
 * The server mailbox is a read-through cache: whatever the provider had to
 * answer is kept, so the same read is not asked of the provider twice.
 *
 * Returns a function that stores fully fetched provider messages after the
 * response. It goes through the store's hydration path, the one sync uses for
 * messages it fetches on demand, so rows carry the same headers, labels,
 * folder, conversation, version and content. That path keeps a newer stored
 * version and recomputes effective state, so operations still waiting for the
 * provider stay applied. It never touches coverage: it fills rows only.
 *
 * Only messages the store cannot serve are written; a complete row is left to
 * sync. Failures are logged and never reach the caller.
 */
export function createStoredWriteBack(
  provider: Pick<EmailProvider, "name">,
  emailAccountId: string,
  logger: Logger,
) {
  const providerName = provider.name === "microsoft" ? "microsoft" : "google";
  return (messages: Array<ParsedMessage | null | undefined>) => {
    const complete = messages.filter(isFullyFetched);
    if (complete.length === 0) return;
    afterResponseOrNow(() =>
      persistProviderMessages({
        emailAccountId,
        providerName,
        messages: complete,
        logger,
      }),
    );
  };
}

/** Awaitable core of the write-back; never throws. */
export async function persistProviderMessages({
  emailAccountId,
  providerName,
  messages,
  logger,
}: {
  emailAccountId: string;
  providerName: "google" | "microsoft";
  messages: ParsedMessage[];
  logger: Logger;
}) {
  try {
    const byId = new Map(messages.map((message) => [message.id, message]));
    const driver = await getServerMailboxDriver(emailAccountId);
    const stored = await readStoredMessages(driver, nodeBodyCodec, {
      accountId: emailAccountId,
      messageIds: [...byId.keys()],
    });
    for (const entry of stored) {
      if (isStoredMessageUsable(entry)) byId.delete(entry.message.messageId);
    }
    const missing = [...byId.values()];
    if (missing.length === 0) return;

    const { store, session } = await getServerMailStore(emailAccountId);
    for (let start = 0; start < missing.length; start += WRITE_BATCH_SIZE) {
      const batch = missing.slice(start, start + WRITE_BATCH_SIZE);
      await store.applyHydration({
        session,
        requestId: `write-back-${randomUUID()}`,
        changes: batch.map((message) =>
          parsedMessagePatch(emailAccountId, providerName, message),
        ),
        bodies: hydratedBodies(emailAccountId, batch),
      });
    }
    logger.trace("Wrote provider reads back to the server mailbox", {
      messages: missing.length,
    });
  } catch (error) {
    logger.warn("Could not write provider reads back to the server mailbox", {
      error,
    });
  }
}

/**
 * Whether the store can answer a read for the message: a row without headers
 * predates stored headers, and one without a body is only partly known.
 */
export function isStoredMessageUsable(
  entry: StoredMessage,
): entry is StoredMessage & {
  message: { headers: NonNullable<StoredMessage["message"]["headers"]> };
  content: NonNullable<StoredMessage["content"]>;
} {
  return Boolean(entry.message.headers && entry.content);
}

// A message parsed without its Message-ID header came from a partial fetch;
// storing it would record an empty body as if it were the real one.
function isFullyFetched(
  message: ParsedMessage | null | undefined,
): message is ParsedMessage {
  return Boolean(
    message?.id && message.threadId && message.headers?.["message-id"],
  );
}
