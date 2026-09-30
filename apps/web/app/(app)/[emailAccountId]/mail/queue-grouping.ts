import { QUEUES } from "@/components/shell/nav-config";
import type { EmailLabels } from "@/providers/email-label-types";

export type QueueId = (typeof QUEUES)[number]["id"];

export type QueueViewMode = "queues" | "timeline";

export const OTHER_GROUP_NAME = "Everything else";

const VIEW_MODE_STORAGE_KEY = "mail-list-view-mode";

/** Full class names, so Tailwind can see them. */
export const QUEUE_DOT_CLASS: Record<QueueId, string> = {
  reply: "bg-queue-reply",
  waiting: "bg-queue-waiting",
  fyi: "bg-queue-fyi",
  newsletter: "bg-queue-newsletter",
  receipt: "bg-queue-receipt",
  calendar: "bg-queue-calendar",
};

export function getQueueName(queueId: QueueId | null) {
  if (!queueId) return OTHER_GROUP_NAME;
  return QUEUES.find((queue) => queue.id === queueId)?.name ?? OTHER_GROUP_NAME;
}

/** Maps label ids to the queue their name belongs to. */
export function buildQueueLabelLookup(labels: EmailLabels) {
  const lookup = new Map<string, QueueId>();
  for (const label of Object.values(labels)) {
    const name = label.name.trim().toLowerCase();
    const queue = QUEUES.find((candidate) =>
      (candidate.labels as readonly string[]).includes(name),
    );
    if (queue) lookup.set(label.id, queue.id);
  }
  return lookup;
}

/** The first queue, in queue order, that any message of the thread carries. */
export function getThreadQueueId(
  messages: { labelIds?: string[] }[],
  lookup: Map<string, QueueId>,
): QueueId | null {
  const found = new Set<QueueId>();
  for (const message of messages) {
    for (const labelId of message.labelIds ?? []) {
      const queueId = lookup.get(labelId);
      if (queueId) found.add(queueId);
    }
  }
  return QUEUES.find((queue) => found.has(queue.id))?.id ?? null;
}

/**
 * Stable-sorts threads into queue order, with unqueued threads last. Order
 * inside a queue is the incoming order.
 */
export function orderThreadsByQueue<T>(
  threads: T[],
  getQueueIdOf: (thread: T) => QueueId | null,
): T[] {
  const rank = (thread: T) => {
    const queueId = getQueueIdOf(thread);
    if (!queueId) return QUEUES.length;
    return QUEUES.findIndex((queue) => queue.id === queueId);
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

export function getQueueIdByName(name: string): QueueId | null {
  return QUEUES.find((queue) => queue.name === name)?.id ?? null;
}
