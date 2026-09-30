import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import { getPremiumUserFilter } from "@/utils/premium";
import { getGmailClientWithRefresh } from "@/utils/gmail/client";
import { withGmailRetry } from "@/utils/gmail/retry";
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
    select: {
      id: true,
      email: true,
      account: {
        select: {
          access_token: true,
          refresh_token: true,
          expires_at: true,
        },
      },
    },
  });

  let polled = 0;
  let failed = 0;

  for (const emailAccount of emailAccounts) {
    const accountLogger = logger.with({ emailAccountId: emailAccount.id });

    try {
      const gmail = await getGmailClientWithRefresh({
        accessToken: emailAccount.account.access_token,
        refreshToken: emailAccount.account.refresh_token,
        expiresAt: emailAccount.account.expires_at?.getTime() ?? null,
        emailAccountId: emailAccount.id,
        logger: accountLogger,
      });

      const profile = await withGmailRetry(
        () => gmail.users.getProfile({ userId: "me" }),
        5,
        { logger: accountLogger },
      );
      const historyId = profile.data.historyId;
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
