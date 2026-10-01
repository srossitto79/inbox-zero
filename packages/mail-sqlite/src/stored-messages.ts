import type { ConfirmedMessage } from "@inboxzero/mail-core/effective-state";
import type { MessageAttachmentDescriptor } from "@inboxzero/mail-core/messages";
import type { SqlTransaction, SqliteDriver } from "./driver";
import { decodeMessageBody, type MessageBodyCodec } from "./message-body-codec";
import { confirmedFromRow, parseStoredAttachments } from "./store";

export type StoredMessage = {
  message: ConfirmedMessage;
  content: {
    html: string | null;
    text: string | null;
    attachments: MessageAttachmentDescriptor[];
    isMeetingInvitation: boolean;
  } | null;
};

const MAX_IDS_PER_QUERY = 200;

/**
 * Confirmed messages with their bodies, as the provider last reported them.
 * For a host that serves server-side reads from the mailbox store instead of
 * asking the provider again. Deleted and unknown ids are left out.
 */
export function readStoredMessages(
  driver: SqliteDriver,
  bodyCodec: MessageBodyCodec,
  input: { accountId: string; messageIds: string[] },
): Promise<StoredMessage[]> {
  return driver.read(async (tx) => {
    const results: StoredMessage[] = [];
    for (
      let start = 0;
      start < input.messageIds.length;
      start += MAX_IDS_PER_QUERY
    ) {
      const ids = input.messageIds.slice(start, start + MAX_IDS_PER_QUERY);
      const rows = await tx.query(
        `SELECT * FROM messages WHERE account_id = ? AND deleted = 0 AND message_id IN (${ids.map(() => "?").join(",")})`,
        [input.accountId, ...ids],
      );
      results.push(
        ...(await withContent(tx, bodyCodec, input.accountId, rows)),
      );
    }
    return results;
  });
}

/** Every stored message of one conversation, oldest first. */
export function readStoredConversation(
  driver: SqliteDriver,
  bodyCodec: MessageBodyCodec,
  input: { accountId: string; conversationId: string },
): Promise<StoredMessage[]> {
  return driver.read(async (tx) => {
    const rows = await tx.query(
      "SELECT * FROM messages WHERE account_id = ? AND conversation_id = ? AND deleted = 0 ORDER BY received_at_ms ASC, message_id ASC",
      [input.accountId, input.conversationId],
    );
    return withContent(tx, bodyCodec, input.accountId, rows);
  });
}

async function withContent(
  tx: SqlTransaction,
  bodyCodec: MessageBodyCodec,
  accountId: string,
  rows: Array<Record<string, import("./driver").SqlValue>>,
): Promise<StoredMessage[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => String(row.message_id));
  const contentRows = await tx.query(
    `SELECT message_id, html, text, attachments_json, is_meeting_invitation FROM message_content WHERE account_id = ? AND message_id IN (${ids.map(() => "?").join(",")})`,
    [accountId, ...ids],
  );
  const contentById = new Map<string, StoredMessage["content"]>();
  for (const row of contentRows) {
    contentById.set(String(row.message_id), {
      html: await decodeMessageBody(bodyCodec, row.html),
      text: await decodeMessageBody(bodyCodec, row.text),
      attachments: parseStoredAttachments(row.attachments_json),
      isMeetingInvitation: Number(row.is_meeting_invitation) === 1,
    });
  }
  return rows.map((row) => ({
    message: confirmedFromRow(row),
    content: contentById.get(String(row.message_id)) ?? null,
  }));
}
