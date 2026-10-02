import "server-only";
import type { ConfirmedMessage } from "@inboxzero/mail-core/effective-state";
import type { Coverage, MailPredicate } from "@inboxzero/mail-core/queries";
import type { SqliteDriver } from "@inboxzero/mail-sqlite/driver";
import {
  countStoredMessages,
  findStoredParticipantConversations,
  findStoredParticipantMessages,
  readStoredConversationMessages,
  readStoredConversationPage,
  readStoredMessagePage,
} from "@inboxzero/mail-sqlite/stored-queries";
import { getSearchTermForSender } from "@/utils/email";
import type { EmailProvider, EmailThread } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import { isMetadataCoverageComplete } from "@/utils/mail-engine/coverage";
import { conversationMessageToParsed } from "@/utils/mail-engine/conversation-thread";
import { getServerMailboxDriver } from "@/utils/mail-engine/server/engine-registry";
import type { ThreadsQuery } from "@/utils/threads/validation";
import type { ParsedMessage } from "@/utils/types";

// The engine catches up every minute; an older completed sync means it is
// stuck, and the provider is the better source.
const MAX_SYNC_AGE_MS = 15 * 60_000;
const MAX_THREAD_PAGE_SIZE = 100;
const MAX_MESSAGE_PAGE_SIZE = 500;
// Gmail caps the hydrated message listings it serves at this many.
const MAX_HYDRATED_MESSAGES = 20;
const HYDRATE_BATCH_SIZE = 100;
const STORE_TOKEN_PREFIX = "mailstore.";

type TokenKind = "threads" | "messages";
type Context = { emailAccountId: string; logger: Logger };
type StoredQueryReads = ReturnType<typeof createHandlers>;
type Handled = keyof StoredQueryReads;

/**
 * Query-shaped mailbox reads answered from the server mailbox store when its
 * coverage is complete and recent, and by the provider otherwise. Gmail only:
 * the translations below reproduce Gmail's listing semantics.
 *
 * Page tokens minted here are prefixed, so a continuation always returns to
 * the source that started the listing. A store token whose store can no longer
 * answer is an error: the provider cannot continue it.
 */
export function createStoredQueryReads(
  provider: EmailProvider,
  emailAccountId: string,
  logger: Logger,
): Partial<StoredQueryReads> {
  if (provider.name !== "google") return {};
  return createHandlers({ emailAccountId, logger });
}

export function findStoredQueryRead(
  reads: Partial<StoredQueryReads>,
  property: string | symbol,
) {
  if (typeof property !== "string" || !Object.hasOwn(reads, property)) return;
  return reads[property as Handled] as Handler<keyof EmailProvider> | undefined;
}

type Handler<K extends keyof EmailProvider> = (
  target: EmailProvider,
  self: EmailProvider,
) => EmailProvider[K];

function createHandlers(context: Context) {
  const { emailAccountId } = context;

  const getThreadsWithQuery: Handler<"getThreadsWithQuery"> =
    (target, self) => async (options) => {
      const plan = planThreadsQuery(options);
      if (!plan) return target.getThreadsWithQuery(options);
      const metadataOnly = options.messageFormat === "metadata";
      const page = await readStore(
        context,
        "getThreadsWithQuery",
        options.pageToken,
        "threads",
        async (driver, after) => {
          const conversations = await readStoredConversationPage(driver, {
            accountIds: [emailAccountId],
            predicate: plan.predicate,
            order: "newest_first",
            pageSize: plan.pageSize,
            after,
          });
          if (!isUsable(conversations.coverage)) return null;
          const messages = await readStoredConversationMessages(driver, {
            accountId: emailAccountId,
            conversationIds: conversations.conversationIds,
          });
          // Without stored headers the list rows would lack what the provider
          // reports with them.
          if (
            metadataOnly &&
            [...messages.values()].some((list) =>
              list.some((message) => !message.headers),
            )
          ) {
            return null;
          }
          return { ...conversations, messages };
        },
      );
      if (!page) return target.getThreadsWithQuery(options);

      const threads = await toThreads(
        self,
        page.conversationIds,
        page.messages,
        {
          metadataOnly,
        },
      );
      return {
        threads,
        nextPageToken: encodeStoreToken("threads", page.nextPage),
      };
    };

  const getThreadsWithParticipant: Handler<"getThreadsWithParticipant"> =
    (target, self) => async (options) => {
      const maxThreads = options.maxThreads ?? 5;
      const page = await readStore(
        context,
        "getThreadsWithParticipant",
        undefined,
        "threads",
        async (driver) => {
          const found = await findStoredParticipantConversations(driver, {
            accountId: emailAccountId,
            term: options.participantEmail,
            fields: ["from", "to"],
            limit: maxThreads,
          });
          if (!isUsable(found.coverage)) return null;
          const messages = await readStoredConversationMessages(driver, {
            accountId: emailAccountId,
            conversationIds: found.conversationIds,
          });
          return { conversationIds: found.conversationIds, messages };
        },
      );
      if (!page) return target.getThreadsWithParticipant(options);
      return toThreads(self, page.conversationIds, page.messages, {
        metadataOnly: false,
      });
    };

  const getMessagesWithPagination: Handler<"getMessagesWithPagination"> =
    (target, self) => async (options) => {
      const predicate = messagesPredicate(options);
      const limit = options.maxResults || 20;
      if (!predicate || limit > MAX_MESSAGE_PAGE_SIZE) {
        return target.getMessagesWithPagination(options);
      }
      const page = await readMessagePage({
        context,
        method: "getMessagesWithPagination",
        pageToken: options.pageToken,
        predicate,
        limit,
      });
      if (!page) return target.getMessagesWithPagination(options);
      return {
        messages: await hydrateMessages(self, page.messageIds),
        nextPageToken: page.nextPageToken,
      };
    };

  const getSentMessages: Handler<"getSentMessages"> =
    (target, self) =>
    async (maxResults = 20) => {
      const page = await readMessagePage({
        context,
        method: "getSentMessages",
        predicate: allMessages([{ kind: "role", role: "sent" }]),
        limit: Math.min(maxResults || 20, MAX_HYDRATED_MESSAGES),
      });
      if (!page) return target.getSentMessages(maxResults);
      return hydrateMessages(self, page.messageIds);
    };

  const getInboxMessages: Handler<"getInboxMessages"> =
    (target, self) =>
    async (maxResults = 20) => {
      const page = await readMessagePage({
        context,
        method: "getInboxMessages",
        predicate: allMessages([{ kind: "role", role: "inbox" }]),
        limit: Math.min(maxResults || 20, MAX_HYDRATED_MESSAGES),
      });
      if (!page) return target.getInboxMessages(maxResults);
      return hydrateMessages(self, page.messageIds);
    };

  const getSentMessageIds: Handler<"getSentMessageIds"> =
    (target) => async (options) => {
      if (
        options.maxResults < 1 ||
        options.maxResults > MAX_MESSAGE_PAGE_SIZE
      ) {
        return target.getSentMessageIds(options);
      }
      const clauses: MailPredicate[] = [{ kind: "role", role: "sent" }];
      // Gmail's day-granular search is widened by a second on each side.
      const afterMs = options.after
        ? (Math.floor(options.after.getTime() / 1000) - 1) * 1000
        : null;
      const beforeMs = options.before
        ? (Math.floor(options.before.getTime() / 1000) + 1) * 1000
        : null;
      if (afterMs !== null || beforeMs !== null) {
        clauses.push({ kind: "received", afterMs, beforeMs });
      }
      const page = await readMessagePage({
        context,
        method: "getSentMessageIds",
        pageToken: options.pageToken,
        predicate: allMessages(clauses),
        limit: options.maxResults,
      });
      if (!page) return target.getSentMessageIds(options);
      return {
        messages: page.refs.map((ref) => ({
          id: ref.messageId,
          threadId: ref.conversationId,
        })),
        nextPageToken: page.nextPageToken,
      };
    };

  const getInboxStats: Handler<"getInboxStats"> = (target) => async () => {
    const stats = await readStore(
      context,
      "getInboxStats",
      undefined,
      "messages",
      async (driver) => {
        const counts = await countStoredMessages(driver, {
          accountId: emailAccountId,
          predicate: { kind: "role", role: "inbox" },
        });
        return isUsable(counts.coverage) ? counts : null;
      },
    );
    if (!stats) return target.getInboxStats();
    return { total: stats.total, unread: stats.unread };
  };

  const hasPreviousCommunicationsWithSenderOrDomain: Handler<
    "hasPreviousCommunicationsWithSenderOrDomain"
  > = (target) => async (options) => {
    const found = await readStore(
      context,
      "hasPreviousCommunicationsWithSenderOrDomain",
      undefined,
      "messages",
      async (driver) => {
        const result = await findStoredParticipantMessages(driver, {
          accountId: emailAccountId,
          term: getSearchTermForSender(options.from),
          fields: ["from", "to"],
          receivedBeforeMs: Math.floor(options.date.getTime() / 1000) * 1000,
          excludeMessageId: options.messageId,
          limit: 1,
        });
        return answerOrNull(result.messageIds.length > 0, result.coverage);
      },
    );
    if (!found)
      return target.hasPreviousCommunicationsWithSenderOrDomain(options);
    return found.answer;
  };

  const checkIfReplySent: Handler<"checkIfReplySent"> =
    (target) => async (senderEmail) => {
      const found = await readStore(
        context,
        "checkIfReplySent",
        undefined,
        "messages",
        async (driver) => {
          const result = await findStoredParticipantMessages(driver, {
            accountId: emailAccountId,
            term: senderEmail,
            fields: ["to"],
            sentOnly: true,
            limit: 1,
          });
          return answerOrNull(result.messageIds.length > 0, result.coverage);
        },
      );
      if (!found) return target.checkIfReplySent(senderEmail);
      return found.answer;
    };

  const countReceivedMessages: Handler<"countReceivedMessages"> =
    (target) => async (senderEmail, threshold) => {
      if (threshold < 1 || threshold > MAX_MESSAGE_PAGE_SIZE) {
        return target.countReceivedMessages(senderEmail, threshold);
      }
      const found = await readStore(
        context,
        "countReceivedMessages",
        undefined,
        "messages",
        async (driver) => {
          const result = await findStoredParticipantMessages(driver, {
            accountId: emailAccountId,
            term: senderEmail,
            fields: ["from"],
            limit: threshold,
          });
          const count = result.messageIds.length;
          // Reaching the threshold is settled whatever else is missing.
          if (count >= threshold || isUsable(result.coverage)) return { count };
          return null;
        },
      );
      if (!found) return target.countReceivedMessages(senderEmail, threshold);
      return found.count;
    };

  return {
    getThreadsWithQuery,
    getThreadsWithParticipant,
    getMessagesWithPagination,
    getSentMessages,
    getInboxMessages,
    getSentMessageIds,
    getInboxStats,
    hasPreviousCommunicationsWithSenderOrDomain,
    checkIfReplySent,
    countReceivedMessages,
  } satisfies Record<string, Handler<keyof EmailProvider>>;
}

/**
 * A page of the store, or null when the provider should answer instead. A
 * continuation of a store listing never falls back: it throws.
 */
async function readStore<T>(
  { emailAccountId, logger }: Context,
  method: string,
  pageToken: string | undefined,
  kind: TokenKind,
  read: (driver: SqliteDriver, after: string | null) => Promise<T | null>,
): Promise<T | null> {
  const continuing = isStoreToken(pageToken);
  // A provider token belongs to a listing the provider started.
  if (pageToken && !continuing) return null;
  try {
    const driver = await getServerMailboxDriver(emailAccountId);
    const result = await read(
      driver,
      continuing ? decodeStoreToken(pageToken, kind) : null,
    );
    if (result) return result;
    logger.trace("Server mailbox cannot answer yet", { method });
  } catch (error) {
    if (continuing) throw new StorePageUnavailableError(method, error);
    logger.warn("Could not read the server mailbox", { method, error });
    return null;
  }
  if (continuing) throw new StorePageUnavailableError(method);
  return null;
}

export class StorePageUnavailableError extends Error {
  constructor(method: string, cause?: unknown) {
    super(`The server mailbox can no longer continue this ${method} page`, {
      cause,
    });
    this.name = "StorePageUnavailableError";
  }
}

async function readMessagePage({
  context,
  method,
  predicate,
  limit,
  pageToken,
}: {
  context: Context;
  method: string;
  predicate: MailPredicate;
  limit: number;
  pageToken?: string;
}) {
  const page = await readStore(
    context,
    method,
    pageToken,
    "messages",
    async (driver, after) => {
      const result = await readStoredMessagePage(driver, {
        accountId: context.emailAccountId,
        predicate,
        limit,
        after,
      });
      return isUsable(result.coverage) ? result : null;
    },
  );
  if (!page) return null;
  return {
    refs: page.messages,
    messageIds: page.messages.map((message) => message.messageId),
    nextPageToken: encodeStoreToken("messages", page.nextPage),
  };
}

function isUsable(coverage: Coverage[], now = Date.now()) {
  return (
    isMetadataCoverageComplete(coverage) &&
    coverage.every(
      (item) =>
        item.lastCompletedSyncAtMs !== null &&
        now - item.lastCompletedSyncAtMs <= MAX_SYNC_AGE_MS,
    )
  );
}

// A match is true whatever the coverage; only "none found" needs it.
function answerOrNull(found: boolean, coverage: Coverage[]) {
  if (found || isUsable(coverage)) return { answer: found };
  return null;
}

function encodeStoreToken(kind: TokenKind, cursor: string | null) {
  if (!cursor) return;
  return `${STORE_TOKEN_PREFIX}${kind}.${Buffer.from(cursor).toString("base64url")}`;
}

/** Whether a page token continues a listing served from the server mailbox. */
export function isStoreToken(
  token: string | null | undefined,
): token is string {
  return !!token?.startsWith(STORE_TOKEN_PREFIX);
}

function decodeStoreToken(token: string, kind: TokenKind) {
  const prefix = `${STORE_TOKEN_PREFIX}${kind}.`;
  if (!token.startsWith(prefix))
    throw new Error("Page token is for another listing");
  return Buffer.from(token.slice(prefix.length), "base64url").toString();
}

const SYSTEM_ROLES = {
  INBOX: "inbox",
  SENT: "sent",
  DRAFT: "draft",
  TRASH: "trash",
  SPAM: "spam",
} as const;

function labelPredicate(labelId: string): MailPredicate {
  if (labelId in SYSTEM_ROLES) {
    return {
      kind: "role",
      role: SYSTEM_ROLES[labelId as keyof typeof SYSTEM_ROLES],
    };
  }
  if (labelId === "UNREAD") return { kind: "read", value: false };
  if (labelId === "STARRED") return { kind: "starred", value: true };
  return {
    kind: "any",
    predicates: [
      { kind: "membership", membership: "label", id: labelId },
      { kind: "membership", membership: "category", id: labelId },
    ],
  };
}

// Gmail leaves spam and trash out of a listing unless a label asks for them.
function allMessages(clauses: MailPredicate[]): MailPredicate {
  const wantsSpamOrTrash = clauses.some(
    (clause) =>
      clause.kind === "role" &&
      (clause.role === "spam" || clause.role === "trash"),
  );
  return {
    kind: "all",
    predicates: wantsSpamOrTrash
      ? clauses
      : [...clauses, { kind: "mailbox", mailbox: "all" }],
  };
}

function gmailLabelIds(query: ThreadsQuery) {
  if (query.labelIds?.length) return query.labelIds;
  if (query.labelId) return [query.labelId];
  switch (query.type) {
    case "inbox":
      return ["INBOX"];
    case "sent":
      return ["SENT"];
    case "draft":
      return ["DRAFT"];
    case "trash":
      return ["TRASH"];
    case "spam":
      return ["SPAM"];
    case "starred":
      return ["STARRED"];
    case "important":
      return ["IMPORTANT"];
    case "unread":
      return ["UNREAD"];
    case "archive":
    case "all":
      return [];
    default:
      if (!query.type || query.type === "undefined" || query.type === "null") {
        return ["INBOX"];
      }
      return [query.type];
  }
}

/** Null when the query uses something the store cannot reproduce. */
function planThreadsQuery(
  options: Parameters<EmailProvider["getThreadsWithQuery"]>[0],
) {
  const query = options.query ?? {};
  const pageSize = options.maxResults || 50;
  if (pageSize > MAX_THREAD_PAGE_SIZE) return null;
  if (
    query.q ||
    query.folderId ||
    query.excludeLabelNames?.length ||
    query.anyOf?.length ||
    query.anyLabelIds?.length ||
    query.excludeSplits?.length ||
    // Gmail filters domain senders client-side over several pages.
    query.fromEmail?.trim().startsWith("@")
  ) {
    return null;
  }

  const clauses = gmailLabelIds(query).map(labelPredicate);
  if (query.type === "archive") {
    clauses.push({ kind: "not", predicate: { kind: "role", role: "inbox" } });
  }
  if (query.isUnread) clauses.push({ kind: "read", value: false });
  if (query.fromEmail) {
    clauses.push({
      kind: "address",
      field: "from",
      value: query.fromEmail,
      match: "address",
    });
  }
  if (query.after || query.before) {
    clauses.push({
      kind: "received",
      afterMs: query.after
        ? Math.floor(query.after.getTime() / 1000) * 1000
        : null,
      beforeMs: query.before
        ? Math.floor(query.before.getTime() / 1000) * 1000
        : null,
    });
  }
  return { predicate: allMessages(clauses), pageSize };
}

const SAFE_ADDRESS = /^[\w.+'@-]+$/;

/**
 * The Gmail search strings that callers build for message listings, when they
 * stay within what the store can match. Null for anything else.
 */
function messagesPredicate(
  options: Parameters<EmailProvider["getMessagesWithPagination"]>[0],
): MailPredicate | null {
  const query = options.query ?? "";
  const clauses: MailPredicate[] = [];
  for (const token of query.split(/\s+/).filter(Boolean)) {
    const lower = token.toLowerCase();
    if (lower === "has:attachment") {
      clauses.push({ kind: "has_attachment", value: true });
    } else if (lower === "in:inbox") {
      clauses.push({ kind: "role", role: "inbox" });
    } else if (lower === "is:unread") {
      clauses.push({ kind: "read", value: false });
    } else if (lower.startsWith("from:") && SAFE_ADDRESS.test(token.slice(5))) {
      clauses.push({
        kind: "address",
        field: "from",
        value: token.slice(5),
        match: "address",
      });
    } else {
      return null;
    }
  }
  if (options.inboxOnly && !query.includes("in:")) {
    clauses.push({ kind: "role", role: "inbox" });
  }
  if (options.unreadOnly && !query.includes("is:unread")) {
    clauses.push({ kind: "read", value: false });
  }
  if (options.before || options.after) {
    // Gmail's search is widened by a second on each side.
    clauses.push({
      kind: "received",
      afterMs: options.after
        ? (Math.floor(options.after.getTime() / 1000) - 1) * 1000
        : null,
      beforeMs: options.before
        ? (Math.floor(options.before.getTime() / 1000) + 1) * 1000
        : null,
    });
  }
  if (!options.includeDrafts) {
    clauses.push({
      kind: "not",
      predicate: { kind: "role", role: "draft" },
    });
  }
  return allMessages(clauses);
}

async function hydrateMessages(self: EmailProvider, messageIds: string[]) {
  const byId = await hydrateById(self, messageIds);
  return messageIds.flatMap((id) => {
    const message = byId.get(id);
    return message ? [message] : [];
  });
}

async function hydrateById(self: EmailProvider, messageIds: string[]) {
  const byId = new Map<string, ParsedMessage>();
  for (let start = 0; start < messageIds.length; start += HYDRATE_BATCH_SIZE) {
    const batch = await self.getMessagesBatch(
      messageIds.slice(start, start + HYDRATE_BATCH_SIZE),
    );
    for (const message of batch) byId.set(message.id, message);
  }
  return byId;
}

async function toThreads(
  self: EmailProvider,
  conversationIds: string[],
  stored: Map<string, ConfirmedMessage[]>,
  { metadataOnly }: { metadataOnly: boolean },
): Promise<EmailThread[]> {
  const full = metadataOnly
    ? null
    : await hydrateById(
        self,
        conversationIds.flatMap((id) =>
          (stored.get(id) ?? []).map((message) => message.messageId),
        ),
      );
  return conversationIds.flatMap((conversationId) => {
    const messages = (stored.get(conversationId) ?? []).flatMap((message) => {
      const parsed = full
        ? full.get(message.messageId)
        : toMetadataMessage(message);
      return parsed ? [parsed] : [];
    });
    if (messages.length === 0) return [];
    return [
      { id: conversationId, messages, snippet: messages.at(-1)?.snippet ?? "" },
    ];
  });
}

// The headers Gmail's metadata format reports.
function toMetadataMessage(message: ConfirmedMessage): ParsedMessage {
  const parsed = conversationMessageToParsed(
    {
      key: {
        accountId: message.accountId,
        conversationId: message.conversationId,
      },
      messages: [],
      nextPage: null,
      coverage: [],
    },
    {
      key: { accountId: message.accountId, messageId: message.messageId },
      metadata: message,
      content: { status: "not_requested" },
      pendingOperationIds: [],
    },
  );
  const { headers } = message;
  return {
    ...parsed,
    historyId: message.version ?? "",
    headers: {
      ...parsed.headers,
      "message-id": headers?.messageId,
      references: headers?.references,
      "in-reply-to": headers?.inReplyTo,
      "reply-to": headers?.replyTo,
      bcc: headers?.bcc,
    },
  };
}
