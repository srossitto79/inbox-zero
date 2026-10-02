import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import { getPremiumUserFilter } from "@/utils/premium";
import { createEmailProvider } from "@/utils/email/provider";
import { processHistoryForUser } from "@/utils/webhook/google/process-history";

// Substitute for the Pub/Sub push webhook on deployments that cannot expose a
// public endpoint. Accounts with an active watch are left to Pub/Sub.
export async function pollGmailAccounts(logger: Logger) {
  const now = new Date();

  const emailAccounts = await prisma.emailAccount.findMany({
    where: {
      ...getPremiumUserFilter(),
      account: { provider: "google", disconnectedAt: null },
      OR: [
        { watchEmailsExpirationDate: null },
        { watchEmailsExpirationDate: { lt: now } },
      ],
    },
    select: { id: true, email: true },
  });

  let polled = 0;
  let failed = 0;

  for (const emailAccount of emailAccounts) {
    const accountLogger = logger.with({ emailAccountId: emailAccount.id });

    try {
      const emailProvider = await createEmailProvider({
        emailAccountId: emailAccount.id,
        provider: "google",
        logger: accountLogger,
        readStoredMail: false,
      });

      const historyId = await emailProvider.getMailboxHistoryId();
      if (!historyId) {
        throw new Error("Gmail did not return a mailbox history ID");
      }

      await processHistoryForUser(
        { emailAddress: emailAccount.email, historyId },
        {},
        accountLogger,
      );
      polled += 1;
    } catch (error) {
      failed += 1;
      accountLogger.error("Failed to poll Gmail account", { error });
    }
  }

  logger.info("Finished polling Gmail accounts", {
    accounts: emailAccounts.length,
    polled,
    failed,
  });

  return { accounts: emailAccounts.length, polled, failed };
}
