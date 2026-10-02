import type { ConfirmedMessage } from "@inboxzero/mail-core/effective-state";
import type {
  ConversationQuery,
  Coverage,
  MailPredicate,
} from "@inboxzero/mail-core/queries";
import type { SqlValue, SqliteDriver } from "./driver";
import { readMailboxViewFromSql } from "./mailbox-view-readers";
import { compilePredicate } from "./queries";
import { confirmedFromRow } from "./store";
import { readCoverage } from "./store-read-utils";

// Text predicates are not offered here, so the search index never matters.
const NO_SEARCH = { fts5: false, complete: false };

export type StoredConversationPage = {
  conversationIds: string[];
  nextPage: string | null;
  coverage: Coverage[];
};

/** One page of conversations matching the predicate, newest first. */
export function readStoredConversationPage(
  driver: SqliteDriver,
  query: ConversationQuery,
): Promise<StoredConversationPage> {
  return driver.read(async (tx) => {
    const { view } = await readMailboxViewFromSql(tx, query, NO_SEARCH);
    return {
      conversationIds: view.conversations.map(
        (conversation) => conversation.key.conversationId,
      ),
      nextPage: view.nextPage,
      coverage: view.coverage,
    };
  });
}

const MAX_CONVERSATIONS_PER_QUERY = 200;

/** Every stored message of the conversations, oldest first, without bodies. */
export function readStoredConversationMessages(
  driver: SqliteDriver,
  input: { accountId: string; conversationIds: string[] },
): Promise<Map<string, ConfirmedMessage[]>> {
  return driver.read(async (tx) => {
    const byConversation = new Map<string, ConfirmedMessage[]>();
    for (
      let start = 0;
      start < input.conversationIds.length;
      start += MAX_CONVERSATIONS_PER_QUERY
    ) {
      const ids = input.conversationIds.slice(
        start,
        start + MAX_CONVERSATIONS_PER_QUERY,
      );
      const rows = await tx.query(
        `SELECT * FROM messages WHERE account_id = ? AND deleted = 0 AND conversation_id IN (${ids.map(() => "?").join(",")}) ORDER BY received_at_ms ASC, message_id ASC`,
        [input.accountId, ...ids],
      );
      for (const row of rows) {
        const message = confirmedFromRow(row);
        const list = byConversation.get(message.conversationId) ?? [];
        list.push(message);
        byConversation.set(message.conversationId, list);
      }
    }
    return byConversation;
  });
}

export type StoredMessageRef = {
  messageId: string;
  conversationId: string;
  receivedAtMs: number;
};

/**
 * One page of confirmed messages matching the predicate, newest first. The
 * cursor is opaque: pass back `nextPage` to continue.
 */
export function readStoredMessagePage(
  driver: SqliteDriver,
  input: {
    accountId: string;
    predicate: MailPredicate;
    limit: number;
    after: string | null;
  },
): Promise<{
  messages: StoredMessageRef[];
  nextPage: string | null;
  coverage: Coverage[];
}> {
  return driver.read(async (tx) => {
    const compiled = compilePredicate(input.predicate, NO_SEARCH, "m");
    const cursor = input.after ? parseMessageCursor(input.after) : null;
    const rows = await tx.query(
      `SELECT m.message_id, m.conversation_id, m.received_at_ms
       FROM messages m
       WHERE m.account_id = ? AND m.deleted = 0 AND ${compiled.sql}
       ${cursor ? "AND (m.received_at_ms < ? OR (m.received_at_ms = ? AND m.message_id > ?))" : ""}
       ORDER BY m.received_at_ms DESC, m.message_id ASC
       LIMIT ?`,
      [
        input.accountId,
        ...compiled.bindings,
        ...(cursor
          ? [cursor.receivedAtMs, cursor.receivedAtMs, cursor.messageId]
          : []),
        input.limit + 1,
      ],
    );
    const page = rows.slice(0, input.limit).map(
      (row): StoredMessageRef => ({
        messageId: String(row.message_id),
        conversationId: String(row.conversation_id),
        receivedAtMs: Number(row.received_at_ms),
      }),
    );
    const last = page.at(-1);
    return {
      messages: page,
      nextPage:
        rows.length > input.limit && last
          ? `${last.receivedAtMs}\t${last.messageId}`
          : null,
      coverage: await readCoverage(tx, [input.accountId]),
    };
  });
}

/** Message counts for a predicate; `unread` counts messages not yet read. */
export function countStoredMessages(
  driver: SqliteDriver,
  input: { accountId: string; predicate: MailPredicate },
): Promise<{ total: number; unread: number; coverage: Coverage[] }> {
  return driver.read(async (tx) => {
    const compiled = compilePredicate(input.predicate, NO_SEARCH, "m");
    const [row] = await tx.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN m.read = 0 THEN 1 ELSE 0 END), 0) AS unread
       FROM messages m
       WHERE m.account_id = ? AND m.deleted = 0 AND ${compiled.sql}`,
      [input.accountId, ...compiled.bindings],
    );
    return {
      total: Number(row?.total ?? 0),
      unread: Number(row?.unread ?? 0),
      coverage: await readCoverage(tx, [input.accountId]),
    };
  });
}

type ParticipantInput = {
  accountId: string;
  term: string;
  fields: Array<"from" | "to">;
  sentOnly?: boolean;
  receivedBeforeMs?: number;
  excludeMessageId?: string;
  limit: number;
};

/**
 * Messages whose sender or recipients contain the term (an address or a
 * domain), outside spam and trash, newest first. Recipients cover To and Cc.
 */
export function findStoredParticipantMessages(
  driver: SqliteDriver,
  input: ParticipantInput,
): Promise<{ messageIds: string[]; coverage: Coverage[] }> {
  return driver.read(async (tx) => {
    const { where, bindings } = participantFilter(input);
    const rows = await tx.query(
      `SELECT m.message_id FROM messages m WHERE ${where}
       ORDER BY m.received_at_ms DESC, m.message_id ASC LIMIT ?`,
      [...bindings, input.limit],
    );
    return {
      messageIds: rows.map((row) => String(row.message_id)),
      coverage: await readCoverage(tx, [input.accountId]),
    };
  });
}

/** The conversations of the same messages, newest first. */
export function findStoredParticipantConversations(
  driver: SqliteDriver,
  input: ParticipantInput,
): Promise<{ conversationIds: string[]; coverage: Coverage[] }> {
  return driver.read(async (tx) => {
    const { where, bindings } = participantFilter(input);
    const rows = await tx.query(
      `SELECT m.conversation_id, MAX(m.received_at_ms) AS latest
       FROM messages m WHERE ${where}
       GROUP BY m.conversation_id
       ORDER BY latest DESC, m.conversation_id ASC LIMIT ?`,
      [...bindings, input.limit],
    );
    return {
      conversationIds: rows.map((row) => String(row.conversation_id)),
      coverage: await readCoverage(tx, [input.accountId]),
    };
  });
}

function participantFilter(input: ParticipantInput) {
  const pattern = `%${escapeLike(input.term.toLowerCase())}%`;
  const matches: string[] = [];
  const matchBindings: SqlValue[] = [];
  if (input.fields.includes("from")) {
    matches.push(`LOWER(m.from_address) LIKE ? ESCAPE '\\'`);
    matchBindings.push(pattern);
  }
  if (input.fields.includes("to")) {
    matches.push(
      `LOWER(m.to_json) LIKE ? ESCAPE '\\'`,
      `LOWER(m.cc_json) LIKE ? ESCAPE '\\'`,
    );
    matchBindings.push(pattern, pattern);
  }
  const conditions = [
    "m.account_id = ?",
    "m.deleted = 0",
    "m.in_trash = 0",
    "m.in_spam = 0",
    `(${matches.join(" OR ")})`,
  ];
  const bindings: SqlValue[] = [input.accountId, ...matchBindings];
  if (input.sentOnly) conditions.push("m.in_sent = 1");
  if (input.receivedBeforeMs !== undefined) {
    conditions.push("m.received_at_ms < ?");
    bindings.push(input.receivedBeforeMs);
  }
  if (input.excludeMessageId) {
    conditions.push("m.message_id != ?");
    bindings.push(input.excludeMessageId);
  }
  return { where: conditions.join(" AND "), bindings };
}

function parseMessageCursor(value: string) {
  const [receivedAt, ...rest] = value.split("\t");
  const receivedAtMs = Number(receivedAt);
  const messageId = rest.join("\t");
  if (!Number.isFinite(receivedAtMs) || !messageId) {
    throw new Error("Invalid message page cursor");
  }
  return { receivedAtMs, messageId };
}

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
