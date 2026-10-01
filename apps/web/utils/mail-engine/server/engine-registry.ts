import "server-only";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createHostRuntime,
  createMailEngine,
  type MailEngine,
} from "@inboxzero/mail-core/engine";
import {
  nodeBodyCodec,
  nodeMailCrypto,
  openOrQuarantineNodeMailbox,
} from "@inboxzero/mail-sqlite/node";
import type { SqliteDriver } from "@inboxzero/mail-sqlite/driver";
import { createSqliteMailStore } from "@inboxzero/mail-sqlite/store";
import { env } from "@/env";
import { isMicrosoftProvider } from "@/utils/email/provider-types";
import { createScopedLogger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import {
  createServerAssistantSource,
  createServerMailboxSource,
  createServerOperationExecutor,
} from "@/utils/mail-engine/server/ports";

const logger = createScopedLogger("mail-engine/server");

const RUN_SLICE_MS = 2000;
const IDLE_DELAY_MS = 250;
const ERROR_DELAY_MS = 1000;
// Keeps the mailbox current with no browser open; catch-up is one cheap
// history call when nothing changed.
const CATCH_UP_INTERVAL_MS = 60_000;

type ServerMailbox = { engine: MailEngine; driver: SqliteDriver };
type ServerMailEngines = Map<string, Promise<ServerMailbox>>;

// Next can load a route module more than once; one engine per account must
// own its SQLite file, so the registry lives on globalThis.
const registryKey = Symbol.for("inbox-zero.server-mail-engines");
const globalRegistry = globalThis as typeof globalThis & {
  [registryKey]?: ServerMailEngines;
};

/** The account's mail engine, started on first use and kept for the process lifetime. */
export async function getServerMailEngine(emailAccountId: string) {
  return (await getServerMailbox(emailAccountId)).engine;
}

/** The SQLite driver behind the account's engine, for server-side reads. */
export async function getServerMailboxDriver(emailAccountId: string) {
  return (await getServerMailbox(emailAccountId)).driver;
}

function getServerMailbox(emailAccountId: string) {
  globalRegistry[registryKey] ??= new Map();
  const mailboxes = globalRegistry[registryKey];
  const existing = mailboxes.get(emailAccountId);
  if (existing) return existing;
  const started = startEngine(emailAccountId).catch((error) => {
    mailboxes.delete(emailAccountId);
    throw error;
  });
  mailboxes.set(emailAccountId, started);
  return started;
}

async function startEngine(emailAccountId: string): Promise<ServerMailbox> {
  const account = await prisma.emailAccount.findUniqueOrThrow({
    where: { id: emailAccountId },
    select: { account: { select: { provider: true } } },
  });
  const provider = account.account.provider;
  const accountLogger = logger.with({ emailAccountId });

  const directory = env.MAIL_STORE_DIR ?? join(process.cwd(), "data", "mail");
  await mkdir(directory, { recursive: true });
  const { driver, quarantinedPaths } = await openOrQuarantineNodeMailbox(
    join(directory, `${emailAccountId}.sqlite`),
  );
  if (quarantinedPaths.length > 0) {
    accountLogger.warn("Quarantined an unreadable mailbox file", {
      quarantinedPaths,
    });
  }

  const runtime = createHostRuntime({
    ...nodeMailCrypto(),
    storagePressure: () => false,
  });
  const store = await createSqliteMailStore(driver, {
    runtime,
    bodyCodec: nodeBodyCodec,
  });
  await store.ensureAccount({
    accountId: emailAccountId,
    provider: isMicrosoftProvider(provider) ? "microsoft" : "google",
    generation: emailAccountId,
  });

  const context = { emailAccountId, provider, logger: accountLogger };
  const engine = createMailEngine({
    store,
    source: createServerMailboxSource(context),
    executor: createServerOperationExecutor(context),
    assistant: createServerAssistantSource(context),
    runtime,
    ownerId: "server-owner",
  });
  await engine.requestSync([emailAccountId]);
  runForever(engine, emailAccountId, accountLogger);
  accountLogger.info("Started server mail engine");
  return { engine, driver };
}

function runForever(
  engine: MailEngine,
  emailAccountId: string,
  accountLogger: typeof logger,
) {
  let lastCatchUpAt = Date.now();
  (async () => {
    while (true) {
      try {
        if (Date.now() - lastCatchUpAt >= CATCH_UP_INTERVAL_MS) {
          lastCatchUpAt = Date.now();
          await engine.requestSync([emailAccountId]);
        }
        await engine.runUntil(Date.now() + RUN_SLICE_MS);
        await delay(IDLE_DELAY_MS);
      } catch (error) {
        accountLogger.error("Server mail engine slice failed", { error });
        await delay(ERROR_DELAY_MS);
      }
    }
  })();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
