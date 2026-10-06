import type { EmailLabels } from "@/providers/email-label-types";
import type { MailQueue, QueueColorVar } from "@/utils/queues";

export type QueueId = MailQueue["id"];

export type QueueViewMode = "queues" | "timeline";

export const OTHER_GROUP_NAME = "Everything else";

const VIEW_MODE_STORAGE_KEY = "mail-list-view-mode";

/** Full class names, so Tailwind can see them. */
export const QUEUE_DOT_CLASS: Record<QueueColorVar, string> = {
  "queue-reply": "bg-queue-reply",
  "queue-waiting": "bg-queue-waiting",
  "queue-fyi": "bg-queue-fyi",
  "queue-newsletter": "bg-queue-newsletter",
  "queue-receipt": "bg-queue-receipt",
  "queue-calendar": "bg-queue-calendar",
};

export function getQueueName(
  queues: readonly MailQueue[],
  queueId: QueueId | null,
) {
  if (!queueId) return OTHER_GROUP_NAME;
  return queues.find((queue) => queue.id === queueId)?.name ?? OTHER_GROUP_NAME;
}

/** Maps label ids to the queue their name belongs to. */
export function buildQueueLabelLookup(
  queues: readonly MailQueue[],
  labels: EmailLabels,
) {
  const lookup = new Map<string, QueueId>();
  for (const label of Object.values(labels)) {
    const name = label.name.trim().toLowerCase();
    const queue = queues.find((candidate) =>
      candidate.labelNames.includes(name),
    );
    if (queue) lookup.set(label.id, queue.id);
  }
  return lookup;
}

/** The first queue, in queue order, that any message of the thread carries. */
export function getThreadQueueId(
  messages: { labelIds?: string[] }[],
  lookup: Map<string, QueueId>,
  queues: readonly MailQueue[],
): QueueId | null {
  const found = new Set<QueueId>();
  for (const message of messages) {
    for (const labelId of message.labelIds ?? []) {
      const queueId = lookup.get(labelId);
      if (queueId) found.add(queueId);
    }
  }
  return queues.find((queue) => found.has(queue.id))?.id ?? null;
}

/**
 * Stable-sorts threads into queue order, with unqueued threads last. Order
 * inside a queue is the incoming order.
 */
export function orderThreadsByQueue<T>(
  threads: T[],
  getQueueIdOf: (thread: T) => QueueId | null,
  queues: readonly MailQueue[],
): T[] {
  const rank = (thread: T) => {
    const queueId = getQueueIdOf(thread);
    if (!queueId) return queues.length;
    const index = queues.findIndex((queue) => queue.id === queueId);
    return index === -1 ? queues.length : index;
  };
  return threads
    .map((thread, position) => ({ thread, position, rank: rank(thread) }))
    .sort((a, b) => a.rank - b.rank || a.position - b.position)
    .map((entry) => entry.thread);
}

export function countThreadsByQueue<T>(
  threads: T[],
  getQueueIdOf: (thread: T) => QueueId | null,
) {
  const counts = new Map<QueueId | null, number>();
  for (const thread of threads) {
    const queueId = getQueueIdOf(thread);
    counts.set(queueId, (counts.get(queueId) ?? 0) + 1);
  }
  return counts;
}

export function readQueueViewMode(): QueueViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "timeline"
      ? "timeline"
      : "queues";
  } catch {
    return "queues";
  }
}

export function writeQueueViewMode(mode: QueueViewMode) {
  try {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage can be blocked; the choice then lasts for the session only.
  }
}

const COLLAPSED_QUEUE_STORAGE_KEY = "mail-collapsed-queues";

/** Queue labels the user hid from the list; session-stable, per browser. */
export function readCollapsedQueueLabels(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_QUEUE_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((label): label is string => typeof label === "string"),
    );
  } catch {
    // Storage can be blocked; queues then start expanded every session.
    return new Set();
  }
}

export function writeCollapsedQueueLabels(labels: ReadonlySet<string>) {
  try {
    localStorage.setItem(
      COLLAPSED_QUEUE_STORAGE_KEY,
      JSON.stringify([...labels]),
    );
  } catch {
    // Storage can be blocked; the choice then lasts for the session only.
  }
}
