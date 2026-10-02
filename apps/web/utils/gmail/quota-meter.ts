import { AsyncLocalStorage } from "node:async_hooks";
import type { gmail_v1 } from "@googleapis/gmail";
import { env } from "@/env";
import { redis } from "@/utils/redis";
import { isEmailProviderRateLimitRedisConfigured } from "@/utils/redis/email-provider-rate-limit";
import type { Logger } from "@/utils/logger";
import { ProviderRateLimitModeError } from "@/utils/email/rate-limit-mode-error";
import {
  assertProviderNotRateLimited,
  getProviderRateLimitDelayMs,
  setEmailProviderRateLimitState,
} from "@/utils/email/rate-limit";

// Gmail allows 15,000 quota units per user per minute. Every request to the
// Gmail API is charged here, at the transport, so no caller can bypass the
// accounting. This is the single source of truth for real Gmail units.
//
// Relation to withLocalMailSyncBudget: the lease there reserves *envelope*
// units (a message is 20 envelope units for 5 real units) and keeps controlling
// concurrency, the app-wide budget and the backfill share. It is deliberately
// not converted to real units. Calls made inside a lease are metered here once,
// in real units, with the lease's priority passed down through
// runWithGmailQuotaPriority. The two counters use separate Redis keys and never
// charge the same units twice.
// https://developers.google.com/workspace/gmail/api/reference/quota

export type GmailQuotaPriority = "current" | "backfill";

const MINUTE_MS = 60_000;
// Gmail's per-minute window has no Retry-After; waiting less than a window
// only fails again and extends the lockout.
const MIN_QUOTA_BACKOFF_MS = MINUTE_MS;
// Background work leaves this share of the ceiling to interactive work.
const BACKFILL_RESERVED_SHARE = 0.3;
// Interactive work may borrow this share of the ceiling beyond it, which still
// leaves headroom under the 15,000 hard limit with the default ceiling.
const CURRENT_BORROW_SHARE = 0.1;
const SOURCE = "gmail-transport";

const gmailQuotaUnitCosts = {
  profile: 1,
  history: 2,
  watch: 100,
  stop: 50,
  labelRead: 1,
  labelWrite: 5,
  draftRead: 5,
  draftCreate: 10,
  draftUpdate: 15,
  draftDelete: 10,
  draftSend: 100,
  messageRead: 5,
  messageWrite: 5,
  messageInsert: 25,
  messageDelete: 10,
  messageBulk: 50,
  messageSend: 100,
  threadRead: 10,
  threadWrite: 10,
  threadDelete: 20,
  settingsRead: 1,
  settingsWrite: 1,
  sendAsWrite: 100,
  // Unrecognised Gmail endpoint: a mid-range charge beats charging nothing.
  unknown: 5,
} as const;

const priorityStorage = new AsyncLocalStorage<GmailQuotaPriority>();

type MeterContext = { emailAccountId: string; logger: Logger };

const clientContexts = new WeakMap<object, MeterContext>();
const tokenContexts = new Map<string, MeterContext>();
const MAX_TOKEN_CONTEXTS = 2000;

let warnedRedisUnavailable = false;

/** Marks Gmail calls made inside `operation` as background work. */
export function runWithGmailQuotaPriority<T>(
  priority: GmailQuotaPriority,
  operation: () => T,
): T {
  return priorityStorage.run(priority, operation);
}

export function getGmailQuotaPriority(): GmailQuotaPriority {
  return priorityStorage.getStore() ?? "current";
}

/** Returns the quota units of a Gmail request, or null when it is not a Gmail API request. */
export function classifyGmailRequestCost({
  method,
  url,
}: {
  method?: string;
  url: string | URL;
}): { operation: string; units: number } | null {
  const pathname = getPathname(url);
  if (!pathname) return null;
  const marker = pathname.indexOf("/gmail/v1/");
  if (marker === -1) return null;

  const verb = (method ?? "GET").toUpperCase();
  const segments = pathname
    .slice(marker + "/gmail/v1/".length)
    .split("/")
    .filter(Boolean);
  if (segments[0] === "users") segments.splice(0, 2);
  const [resource, second, third] = segments;
  const isWrite = verb !== "GET";
  const op = (operation: string, key: keyof typeof gmailQuotaUnitCosts) => ({
    operation,
    units: gmailQuotaUnitCosts[key],
  });

  switch (resource) {
    case "profile":
      return op("users.getProfile", "profile");
    case "history":
      return op("history.list", "history");
    case "watch":
      return op("users.watch", "watch");
    case "stop":
      return op("users.stop", "stop");
    case "labels":
      return isWrite
        ? op(`labels.${verb}`, "labelWrite")
        : op("labels.get", "labelRead");
    case "drafts":
      if (second === "send") return op("drafts.send", "draftSend");
      if (verb === "POST") return op("drafts.create", "draftCreate");
      if (verb === "PUT") return op("drafts.update", "draftUpdate");
      if (verb === "DELETE") return op("drafts.delete", "draftDelete");
      return op("drafts.get", "draftRead");
    case "messages":
      if (second === "send") return op("messages.send", "messageSend");
      if (second === "import") return op("messages.import", "messageInsert");
      if (second === "batchModify" || second === "batchDelete")
        return op(`messages.${second}`, "messageBulk");
      if (!second) {
        return verb === "POST"
          ? op("messages.insert", "messageInsert")
          : op("messages.list", "messageRead");
      }
      if (third === "attachments") return op("attachments.get", "messageRead");
      if (verb === "DELETE") return op("messages.delete", "messageDelete");
      if (verb === "POST") return op(`messages.${third}`, "messageWrite");
      return op("messages.get", "messageRead");
    case "threads":
      if (verb === "DELETE") return op("threads.delete", "threadDelete");
      if (verb === "POST") return op(`threads.${third}`, "threadWrite");
      return op(second ? "threads.get" : "threads.list", "threadRead");
    case "settings":
      if (second === "sendAs" && isWrite)
        return op("settings.sendAs", "sendAsWrite");
      return isWrite
        ? op(`settings.${second}`, "settingsWrite")
        : op(`settings.${second}`, "settingsRead");
    default:
      return op("unknown", "unknown");
  }
}

/** Units of a batch of GET sub-requests against one collection endpoint. */
export function getBatchUnits({
  endpoint,
  count,
}: {
  endpoint: string;
  count: number;
}) {
  const perCall =
    classifyGmailRequestCost({ method: "GET", url: `${endpoint}/id` })?.units ??
    gmailQuotaUnitCosts.unknown;
  return perCall * count;
}

// Redis time keeps admission independent of server clock skew. The bucket holds
// real units and refills continuously over a minute. The floor is what a
// priority may drain it to: positive for background work (it must leave the rest
// to interactive work), negative for interactive work (it may borrow).
const chargeScript = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local cost = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local floor = tonumber(ARGV[3])
local stored = redis.call('HMGET', KEYS[1], 'tokens', 'at')
local tokens = tonumber(stored[1]) or capacity
local at = tonumber(stored[2]) or now
tokens = math.min(capacity, tokens + math.max(0, now - at) * capacity / 60000)
if tokens - cost < floor then
  return math.ceil((floor + cost - tokens) * 60000 / capacity)
end
redis.call('HSET', KEYS[1], 'tokens', tokens - cost, 'at', now)
redis.call('PEXPIRE', KEYS[1], 180000)
return 0
`;

/**
 * Charges `units` against the account's per-minute Gmail budget.
 * Throws ProviderRateLimitModeError, without sending, when rate-limit mode is
 * active or the budget is spent. Fails open when Redis is unavailable.
 */
export async function chargeGmailQuota({
  emailAccountId,
  units,
  priority = getGmailQuotaPriority(),
  logger,
}: {
  emailAccountId: string;
  units: number;
  priority?: GmailQuotaPriority;
  logger: Logger;
}) {
  if (!isEmailProviderRateLimitRedisConfigured()) {
    warnRedisUnavailableOnce(logger, "Redis is not configured");
    return;
  }

  // Rate-limit mode is a hard stop for every priority.
  await assertProviderNotRateLimited({
    emailAccountId,
    provider: "google",
    logger,
    source: SOURCE,
  });

  const capacity = env.GMAIL_QUOTA_UNITS_PER_MINUTE;
  const floor =
    priority === "backfill"
      ? Math.round(capacity * BACKFILL_RESERVED_SHARE)
      : -Math.round(capacity * CURRENT_BORROW_SHARE);

  let waitMs: unknown;
  try {
    waitMs = await redis.eval<string[], number>(
      chargeScript,
      [`gmail-quota:${emailAccountId}`],
      [String(units), String(capacity), String(floor)],
    );
  } catch (error) {
    warnRedisUnavailableOnce(
      logger,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  if (typeof waitMs !== "number" || !Number.isFinite(waitMs) || waitMs <= 0)
    return;

  logger.warn("Gmail quota budget spent; request not sent", {
    emailAccountId,
    units,
    priority,
    waitMs,
  });
  throw new ProviderRateLimitModeError({
    provider: "google",
    retryAt: new Date(Date.now() + waitMs),
  });
}

/** Records rate-limit mode for a real Gmail quota response; no-op for other errors. */
export async function recordGmailQuotaResponse({
  error,
  emailAccountId,
  logger,
}: {
  error: unknown;
  emailAccountId: string;
  logger: Logger;
}) {
  // Errors thrown by the meter itself must not extend the pause they report.
  if (error instanceof ProviderRateLimitModeError) return;

  const delayMs = getProviderRateLimitDelayMs({
    error,
    provider: "google",
    attemptNumber: 1,
  });
  if (delayMs === null) return;

  try {
    await setEmailProviderRateLimitState({
      emailAccountId,
      provider: "google",
      retryAt: new Date(Date.now() + Math.max(MIN_QUOTA_BACKOFF_MS, delayMs)),
      source: SOURCE,
      logger,
    });
  } catch (recordError) {
    logger.warn("Failed to record Gmail rate-limit mode", {
      emailAccountId,
      error: recordError instanceof Error ? recordError.message : recordError,
    });
  }
}

/**
 * Installs the meter on the auth client's transporter. Every Gmail request
 * made through the client, including the ones the googleapis library builds,
 * passes through it.
 */
export function installGmailQuotaMeter({
  authClient,
  client,
  emailAccountId,
  logger,
}: {
  authClient: unknown;
  client: gmail_v1.Gmail;
  emailAccountId: string;
  logger: Logger;
}) {
  const context = { emailAccountId, logger };
  if (client && typeof client === "object") clientContexts.set(client, context);

  const interceptors = (
    authClient as {
      transporter?: {
        interceptors?: {
          request: Set<unknown>;
          response: Set<unknown>;
        };
      };
    }
  ).transporter?.interceptors;
  if (!interceptors) return;

  interceptors.request.add({
    resolved: async (options: { method?: string; url?: string | URL }) => {
      if (!options.url) return options;
      const cost = classifyGmailRequestCost({
        method: options.method,
        url: options.url,
      });
      if (cost)
        await chargeGmailQuota({ emailAccountId, units: cost.units, logger });
      return options;
    },
  });
  interceptors.response.add({
    rejected: async (error: unknown) => {
      await recordGmailQuotaResponse({ error, emailAccountId, logger });
      throw error;
    },
  });
}

/** Lets raw HTTP callers that only hold an access token be metered for the same account. */
export function rememberGmailAccessToken(
  client: object,
  accessToken: string | null | undefined,
) {
  const context = clientContexts.get(client);
  if (!context || !accessToken) return;
  if (tokenContexts.size >= MAX_TOKEN_CONTEXTS) {
    const oldest = tokenContexts.keys().next().value;
    if (oldest !== undefined) tokenContexts.delete(oldest);
  }
  tokenContexts.set(accessToken, context);
}

/**
 * Charges a Gmail batch request, sent outside the googleapis client, to the
 * account that owns `accessToken`. Tokens of unknown accounts are not metered.
 */
export async function chargeGmailBatch({
  accessToken,
  endpoint,
  count,
}: {
  accessToken: string;
  endpoint: string;
  count: number;
}) {
  const context = tokenContexts.get(accessToken);
  if (!context) return null;
  await chargeGmailQuota({
    emailAccountId: context.emailAccountId,
    units: getBatchUnits({ endpoint, count }),
    logger: context.logger,
  });
  return context;
}

function warnRedisUnavailableOnce(logger: Logger, reason: string) {
  if (warnedRedisUnavailable) return;
  warnedRedisUnavailable = true;
  logger.warn("Gmail quota metering unavailable; requests are not metered", {
    reason,
  });
}

function getPathname(url: string | URL) {
  try {
    return typeof url === "string"
      ? new URL(url, "http://localhost").pathname
      : url.pathname;
  } catch {
    return null;
  }
}
