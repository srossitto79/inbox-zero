import type { EmailLabel, EmailProvider } from "@/utils/email/types";
import { labelVisibility } from "@/utils/gmail/constants";
import { inboxZeroLabels } from "@/utils/label";
import type { Logger } from "@/utils/logger";

/**
 * Label and folder lists change rarely and are read on every rule run, which
 * spends the provider's per-minute quota. The server mailbox keeps no label
 * metadata (only label ids per message), so these lists are cached in-process
 * per account for a short time and dropped on every write made through the
 * provider. Changes made outside this process show up after the TTL.
 */
const LABEL_CACHE_TTL_MS = 60_000;

type CacheEntry<T> = { expiresAt: number; value: Promise<T> };

const labelCache = new Map<string, CacheEntry<EmailLabel[]>>();
type Folders = Awaited<ReturnType<EmailProvider["getFolders"]>>;
const folderCache = new Map<string, CacheEntry<Folders>>();

const LABEL_WRITES = new Set<string | symbol>([
  "createLabel",
  "updateLabel",
  "deleteLabel",
]);
const FOLDER_WRITES = new Set<string | symbol>([
  "renameFolder",
  "deleteFolder",
  "getOrCreateFolderIdByName",
  "moveThreadToFolder",
]);

export function clearStoredLabelReads(emailAccountId?: string) {
  if (emailAccountId) {
    labelCache.delete(emailAccountId);
    folderCache.delete(emailAccountId);
  } else {
    labelCache.clear();
    folderCache.clear();
  }
}

export function withStoredLabelReads(
  provider: EmailProvider,
  emailAccountId: string,
  logger: Logger,
): EmailProvider {
  const readLabels = () =>
    readCached(labelCache, emailAccountId, () =>
      provider.getLabels({ includeHidden: true }),
    );

  const invalidate = () => clearStoredLabelReads(emailAccountId);

  return new Proxy(provider, {
    get(target, property, receiver) {
      if (property === "getLabels") {
        return async (options?: { includeHidden?: boolean }) => {
          const labels = await readLabels();
          return options?.includeHidden
            ? labels
            : labels.filter(
                (label) =>
                  label.labelListVisibility !== labelVisibility.labelHide,
              );
        };
      }
      if (property === "getLabelByName") {
        return async (name: string) => {
          const labels = await readLabels().catch(() => []);
          // Exact matches only: name normalisation is provider specific.
          const cached = labels.find((label) => label.name === name);
          if (cached) return cached;
          return target.getLabelByName(name);
        };
      }
      if (property === "getOrCreateInboxZeroLabel") {
        return async (key: keyof typeof inboxZeroLabels) => {
          const { name } = inboxZeroLabels[key];
          const labels = await readLabels().catch(() => []);
          const cached = labels.find((label) => label.name === name);
          if (cached) return cached;
          const label = await target.getOrCreateInboxZeroLabel(key);
          invalidate();
          return label;
        };
      }
      if (property === "labelMessage") {
        return async (...args: Parameters<EmailProvider["labelMessage"]>) => {
          const result = await target.labelMessage(...args);
          // The fallback path creates the label.
          if (result.usedFallback) invalidate();
          return result;
        };
      }
      if (property === "getFolders") {
        return () =>
          readCached(folderCache, emailAccountId, () => target.getFolders());
      }
      if (LABEL_WRITES.has(property) || FOLDER_WRITES.has(property)) {
        const original = Reflect.get(target, property, receiver);
        if (typeof original !== "function") return original;
        return async (...args: unknown[]) => {
          try {
            return await original.apply(receiver, args);
          } finally {
            invalidate();
            logger.trace("Dropped cached labels after a write", {
              operation: String(property),
            });
          }
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function readCached<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = load();
  const entry = { expiresAt: Date.now() + LABEL_CACHE_TTL_MS, value };
  cache.set(key, entry);
  // Failures are not cached.
  value.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  return value;
}
