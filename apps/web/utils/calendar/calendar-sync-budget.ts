import { getProviderRateLimitDelayMs } from "@/utils/email/rate-limit";
import { normalizeThrottleHeaders } from "@/utils/email/local-mail-sync-budget";
import { redis } from "@/utils/redis";
import { isEmailProviderRateLimitRedisConfigured } from "@/utils/redis/email-provider-rate-limit";

// Calendar sync draws on provider quotas of its own: Google Calendar API
// quota is separate from Gmail's, and Graph throttles Outlook calendars per
// mailbox. These envelopes only keep background sync from crowding out
// interactive calendar and booking-link calls; they are not total quotas.
// Costs are in requests, one per page.
// https://developers.google.com/workspace/calendar/api/guides/quota
// https://learn.microsoft.com/en-us/graph/throttling-limits#outlook-service-limits
const policies = {
  google: { account: 60, app: 600 },
  microsoft: { account: 30, app: 300 },
};

const DEFAULT_PAUSE_MS = 60_000;
const BUCKET_TTL_MS = 120_000;
const OPERATION_TIMEOUT_MS = 30_000;

type CalendarSyncBudgetInput = {
  emailAccountId: string;
  provider: keyof typeof policies;
  cost?: number;
};

export class CalendarSyncPausedError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs = DEFAULT_PAUSE_MS) {
    super("Calendar synchronization is paused");
    this.name = "CalendarSyncPausedError";
    this.retryAfterMs = Math.max(1000, retryAfterMs);
  }
}

// Redis time keeps admission independent of application-server clock skew.
// Both buckets are checked before either is debited, so a refused request
// costs nothing. Returns the milliseconds to wait, or 0 when admitted.
const admitScript = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local cost = tonumber(ARGV[1])
local cooldown = tonumber(redis.call('GET', KEYS[3])) or 0
local wait = math.max(0, cooldown - now)
local buckets = {}
for i = 1, 2 do
  local capacity = tonumber(ARGV[i + 1])
  local stored = redis.call('HMGET', KEYS[i], 'tokens', 'at')
  local tokens = tonumber(stored[1]) or capacity
  local at = tonumber(stored[2]) or now
  tokens = math.min(capacity, tokens + math.max(0, now - at) * capacity / 60000)
  buckets[i] = tokens
  if tokens < cost then wait = math.max(wait, math.ceil((cost - tokens) * 60000 / capacity)) end
end
if wait > 0 then return wait end
for i = 1, 2 do
  redis.call('HSET', KEYS[i], 'tokens', buckets[i] - cost, 'at', now)
  redis.call('PEXPIRE', KEYS[i], ${BUCKET_TTL_MS})
end
return 0
`;

/**
 * Every provider call made by calendar sync goes through here. A call is
 * admitted only when the account and application buckets have room and no
 * rate-limit cooldown is active; otherwise it throws CalendarSyncPausedError
 * and the caller stores progress and retries later. A rate-limit response from
 * the provider starts a cooldown. There are no automatic retries.
 */
export async function withCalendarSyncBudget<T>(
  input: CalendarSyncBudgetInput,
  operation: () => Promise<T>,
): Promise<T> {
  const cost = input.cost ?? 1;
  const policy = policies[input.provider];
  if (!input.emailAccountId || !Number.isInteger(cost) || cost < 1) {
    throw new Error("Invalid calendar sync reservation");
  }

  const prefix = `calendar-sync-budget:${input.provider}`;
  const keys = [
    `${prefix}:${input.emailAccountId}:tokens`,
    `${prefix}:tokens`,
    `${prefix}:${input.emailAccountId}:cooldown`,
  ];

  await admit({ keys, cost, policy });

  try {
    return await withTimeout(operation());
  } catch (error) {
    const delayMs = getProviderRateLimitDelayMs({
      error: normalizeThrottleHeaders(error),
      provider: input.provider,
      attemptNumber: 1,
    });
    if (delayMs === null) throw error;

    const pauseMs = Math.max(1000, delayMs);
    await redis
      .set(keys[2], String(Date.now() + pauseMs), { px: pauseMs + 5000 })
      .catch(() => undefined);
    throw new CalendarSyncPausedError(pauseMs);
  }
}

async function admit({
  keys,
  cost,
  policy,
}: {
  keys: string[];
  cost: number;
  policy: { account: number; app: number };
}) {
  if (!isEmailProviderRateLimitRedisConfigured()) {
    throw new CalendarSyncPausedError();
  }

  let wait: unknown;
  try {
    wait = await redis.eval<string[], number>(admitScript, keys, [
      String(cost),
      String(policy.account),
      String(policy.app),
    ]);
  } catch {
    throw new CalendarSyncPausedError();
  }

  if (typeof wait !== "number" || !Number.isFinite(wait) || wait < 0) {
    throw new CalendarSyncPausedError();
  }
  if (wait > 0) throw new CalendarSyncPausedError(wait);
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new CalendarSyncPausedError()),
      OPERATION_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
