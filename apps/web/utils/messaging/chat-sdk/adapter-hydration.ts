import { createScopedLogger } from "@/utils/logger";
import {
  createMessagingAdapterRegistry,
  NoMessagingAdaptersError,
  resetMessagingAdapterRegistry,
} from "@/utils/messaging/chat-sdk/adapters";
import { resetMessagingChatSdkBot } from "@/utils/messaging/chat-sdk/bot";
import { loadAdapterConfigs } from "@/utils/messaging/app-credentials";

const logger = createScopedLogger("messaging-adapter-hydration");

declare global {
  var inboxZeroMessagingAdaptersHydrated: boolean | undefined;
  var inboxZeroMessagingAdapterHydration: Promise<void> | undefined;
}

/**
 * Builds the adapter registry from stored in-app configs for platforms env
 * does not already cover, so a deployment without messaging env vars still
 * gets working bots after an org admin saves credentials. Safe to call
 * concurrently; retries on the next call when loading fails, so a DB outage
 * at boot does not permanently leave adapters un-hydrated.
 */
export async function ensureMessagingAdaptersHydrated(): Promise<void> {
  if (global.inboxZeroMessagingAdaptersHydrated) return;
  if (global.inboxZeroMessagingAdapterHydration) {
    return global.inboxZeroMessagingAdapterHydration;
  }

  global.inboxZeroMessagingAdapterHydration = hydrate()
    .then(() => {
      global.inboxZeroMessagingAdaptersHydrated = true;
    })
    .catch((error) => {
      logger.error("Messaging adapter hydration failed", { error });
    })
    .finally(() => {
      global.inboxZeroMessagingAdapterHydration = undefined;
    });

  return global.inboxZeroMessagingAdapterHydration;
}

/**
 * Drops all hydrated state; the next ensure call rebuilds from env + DB.
 * Used after an in-app config is saved or deleted so the change takes effect
 * without a server restart.
 */
export async function invalidateMessagingAdapterHydration(): Promise<void> {
  global.inboxZeroMessagingAdaptersHydrated = undefined;
  global.inboxZeroMessagingAdapterHydration = undefined;
  resetMessagingAdapterRegistry();
  resetMessagingChatSdkBot();

  await ensureMessagingAdaptersHydrated();
}

async function hydrate(): Promise<void> {
  const dbConfigs = await loadAdapterConfigs();

  const current = global.inboxZeroMessagingAdapterRegistry;
  let next: ReturnType<typeof createMessagingAdapterRegistry> | undefined;
  try {
    next = createMessagingAdapterRegistry(dbConfigs);
  } catch (error) {
    // Nothing configured yet is a normal state, not a failure: stop retrying
    // until a save/delete action invalidates the hydrated state.
    if (error instanceof NoMessagingAdaptersError) {
      logger.trace("No messaging adapters configured", { error });
      return;
    }
    if (!current) throw error;
    // Already running with env-built adapters; nothing stored adds to them.
    logger.trace("Keeping existing messaging adapters", { error });
    return;
  }

  const currentCount = Object.keys(current?.adapters ?? {}).length;
  const nextCount = Object.keys(next.adapters).length;
  if (!current || nextCount > currentCount) {
    resetMessagingAdapterRegistry();
    global.inboxZeroMessagingAdapterRegistry = next;
    if (current) resetMessagingChatSdkBot();
  }
}
