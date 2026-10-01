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

type ServerMailEngines = Map<string, Promise<MailEngine>>;

// Next can load a route module more than once; one engine per account must
// own its SQLite file, so the registry lives on globalThis.
const registryKey = Symbol.for("inbox-zero.server-mail-engines");
const globalRegistry = globalThis as typeof globalThis & {
  [registryKey]?: ServerMailEngines;
};

/** The account's mail engine, started on first use and kept for the process lifetime. */
export function getServerMailEngine(emailAccountId: string) {
  globalRegistry[registryKey] ??= new Map();
  const engines = globalRegistry[registryKey];
  const existing = engines.get(emailAccountId);
  if (existing) return existing;
  const started = startEngine(emailAccountId).catch((error) => {
    engines.delete(emailAccountId);
    throw error;
  });
  engines.set(emailAccountId, started);
  return started;
}

async function startEngine(emailAccountId: string): Promise<MailEngine> {
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
  runForever(engine, accountLogger);
  accountLogger.info("Started server mail engine");
  return engine;
}

function runForever(engine: MailEngine, accountLogger: typeof logger) {
  (async () => {
    while (true) {
      try {
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
