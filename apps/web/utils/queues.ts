import type { ActionType } from "@/generated/prisma/enums";

export type QueueColorVar =
  | "queue-reply"
  | "queue-waiting"
  | "queue-fyi"
  | "queue-newsletter"
  | "queue-receipt"
  | "queue-calendar";

/**
 * A queue in the mail sidebar and list headings. Queues are derived from rules
 * (any rule with "Show in queues sidebar" checked), never hardcoded: `name` and
 * `labelNames` come from the label the rule applies, so the queue always
 * matches the mailbox label it links to.
 */
export type MailQueue = {
  /** The rule that owns the queue (its id keeps lookups stable across renames). */
  id: string;
  /** Display name: the label's own name, matching the label page it opens. */
  name: string;
  /** Lowercased label names the queue claims; matched against mailbox labels. */
  labelNames: string[];
  /** One of the `--queue-*` CSS variables, e.g. "queue-reply". */
  colorVar: QueueColorVar;
};

/**
 * Shown while rules are still loading (or unreadable), so the sidebar keeps the
 * queues it had before they became rule-derived. Named after the labels they
 * claim, in the order they always appeared, so nothing shifts once rules load.
 */
export const LEGACY_QUEUES: MailQueue[] = [
  {
    id: "reply",
    name: "To Reply",
    labelNames: ["to reply"],
    colorVar: "queue-reply",
  },
  {
    id: "waiting",
    name: "Awaiting Reply",
    labelNames: ["awaiting reply"],
    colorVar: "queue-waiting",
  },
  { id: "fyi", name: "FYI", labelNames: ["fyi"], colorVar: "queue-fyi" },
  {
    id: "newsletter",
    name: "Newsletter",
    labelNames: ["newsletter"],
    colorVar: "queue-newsletter",
  },
  {
    id: "receipt",
    name: "Receipt",
    labelNames: ["receipt"],
    colorVar: "queue-receipt",
  },
  {
    id: "calendar",
    name: "Calendar",
    labelNames: ["calendar"],
    colorVar: "queue-calendar",
  },
];

/** Stable ordering: the legacy queues keep their place, new ones follow rules. */
const LEGACY_QUEUE_ORDER = LEGACY_QUEUES.map((queue) => queue.labelNames[0]);

const LEGACY_LABEL_COLORS: Record<string, QueueColorVar> = Object.fromEntries(
  LEGACY_QUEUES.map((queue) => [queue.labelNames[0], queue.colorVar]),
) as Record<string, QueueColorVar>;

type QueueRule = {
  id: string;
  showInQueuesSidebar: boolean;
  actions: Array<{ type: ActionType; label?: string | null }>;
};

/**
 * Rules that opted in, in rules order. A label belongs to at most one queue:
 * when two rules apply the same label the first (rules are already sorted)
 * keeps it, so the sidebar and the list never disagree about where mail lands.
 * Visibility follows the checkbox alone — disabling a rule stops it labeling
 * new mail but must not hide the mail it already labeled.
 */
export function buildQueuesFromRules(rules: QueueRule[]): MailQueue[] {
  const claimed = new Set<string>();
  const queues: MailQueue[] = [];

  for (const rule of rules) {
    if (!rule.showInQueuesSidebar) continue;

    const entries: Array<{ name: string; key: string }> = [];
    for (const action of rule.actions) {
      if (action.type !== "LABEL") continue;
      const name = typeof action.label === "string" ? action.label.trim() : "";
      if (name.length === 0) continue;
      const key = name.toLowerCase();
      if (claimed.has(key)) continue;
      entries.push({ name, key });
    }

    if (entries.length === 0) continue;
    for (const entry of entries) claimed.add(entry.key);

    queues.push({
      id: rule.id,
      name: entries[0].name,
      labelNames: entries.map((entry) => entry.key),
      colorVar: colorVarForLabel(entries[0].key),
    });
  }

  return sortQueues(queues);
}

/** Legacy labels keep their color everywhere; anything else hashes stably. */
function colorVarForLabel(labelKey: string): QueueColorVar {
  const legacy = LEGACY_LABEL_COLORS[labelKey];
  if (legacy) return legacy;

  let hash = 5381;
  for (let index = 0; index < labelKey.length; index++) {
    hash = ((hash << 5) + hash + labelKey.charCodeAt(index)) >>> 0;
  }
  return QUEUE_COLOR_VARS[hash % QUEUE_COLOR_VARS.length];
}

const QUEUE_COLOR_VARS: QueueColorVar[] = [
  "queue-reply",
  "queue-waiting",
  "queue-fyi",
  "queue-newsletter",
  "queue-receipt",
  "queue-calendar",
];

function sortQueues(queues: MailQueue[]): MailQueue[] {
  const rank = (queue: MailQueue) => {
    for (const label of queue.labelNames) {
      const index = LEGACY_QUEUE_ORDER.indexOf(label);
      if (index !== -1) return index;
    }
    return LEGACY_QUEUE_ORDER.length;
  };
  // Stable: equal ranks keep rules order, so disabling a rule doesn't reshuffle.
  return queues
    .map((queue, index) => ({ queue, index }))
    .sort((a, b) => rank(a.queue) - rank(b.queue) || a.index - b.index)
    .map((entry) => entry.queue);
}
