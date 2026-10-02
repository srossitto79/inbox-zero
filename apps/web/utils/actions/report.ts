"use server";

import { z } from "zod";
import { fetchEmailsForReport } from "@/utils/ai/report/fetch";
import { aiSummarizeEmails } from "@/utils/ai/report/summarize-emails";
import { aiGenerateExecutiveSummary } from "@/utils/ai/report/generate-executive-summary";
import { aiBuildUserPersona } from "@/utils/ai/report/build-user-persona";
import { aiAnalyzeEmailBehavior } from "@/utils/ai/report/analyze-email-behavior";
import { aiAnalyzeResponsePatterns } from "@/utils/ai/report/response-patterns";
import { aiAnalyzeLabelOptimization } from "@/utils/ai/report/analyze-label-optimization";
import { aiGenerateActionableRecommendations } from "@/utils/ai/report/generate-actionable-recommendations";
import { actionClient } from "@/utils/actions/safe-action";
import { getEmailAccountWithAi } from "@/utils/user/get";
import { createEmailProvider } from "@/utils/email/provider";
import type { EmailLabel, EmailProvider } from "@/utils/email/types";
import { getEmailForLLM } from "@/utils/get-email-from-message";
import type { Logger } from "@/utils/logger";

export type EmailReportData = Awaited<ReturnType<typeof getEmailReportData>>;

export const generateReportAction = actionClient
  .metadata({ name: "generateReport" })
  .inputSchema(z.object({}))
  .action(async ({ ctx: { emailAccountId, logger } }) =>
    getEmailReportData({ emailAccountId, logger }),
  );

async function getEmailReportData({
  emailAccountId,
  logger,
}: {
  emailAccountId: string;
  logger: Logger;
}) {
  logger.info("getEmailReportData started");

  const emailAccount = await getEmailAccountWithAi({ emailAccountId });

  if (!emailAccount) {
    logger.error("Email account not found");
    throw new Error("Email account not found");
  }

  const { receivedEmails, sentEmails, totalReceived, totalSent } =
    await fetchEmailsForReport({ emailAccount });

  const [receivedSummaries, sentSummaries] = await Promise.all([
    aiSummarizeEmails(
      receivedEmails.map((message) =>
        getEmailForLLM(message, { maxLength: 1000 }),
      ),
      emailAccount,
    ).catch((error) => {
      logger.error("Error summarizing received emails", { error });
      return [];
    }),
    aiSummarizeEmails(
      sentEmails.map((message) => getEmailForLLM(message, { maxLength: 1000 })),
      emailAccount,
    ).catch((error) => {
      logger.error("Error summarizing sent emails", { error });
      return [];
    }),
  ]);

  const emailProvider = await createEmailProvider({
    emailAccountId: emailAccount.id,
    provider: emailAccount.account.provider,
    logger,
  });

  const gmailLabels = await fetchLabels(emailProvider, logger);
  const gmailSignature = await fetchSignature(emailProvider, logger);

  const [
    executiveSummary,
    userPersona,
    emailBehavior,
    responsePatterns,
    labelAnalysis,
  ] = await Promise.all([
    aiGenerateExecutiveSummary(
      receivedSummaries,
      sentSummaries,
      gmailLabels,
      emailAccount,
    ).catch((error) => {
      logger.error("Error generating executive summary", { error });
    }),
    aiBuildUserPersona(
      receivedSummaries,
      emailAccount,
      sentSummaries,
      gmailSignature,
    ).catch((error) => {
      logger.error("Error generating user persona", { error });
    }),
    aiAnalyzeEmailBehavior(
      receivedSummaries,
      emailAccount,
      sentSummaries,
    ).catch((error) => {
      logger.error("Error generating email behavior", { error });
    }),
    aiAnalyzeResponsePatterns(
      receivedSummaries,
      emailAccount,
      sentSummaries,
    ).catch((error) => {
      logger.error("Error generating response patterns", { error });
    }),
    aiAnalyzeLabelOptimization(
      receivedSummaries,
      emailAccount,
      gmailLabels,
    ).catch((error) => {
      logger.error("Error generating label optimization", { error });
    }),
  ]);

  const actionableRecommendations = userPersona
    ? await aiGenerateActionableRecommendations(
        receivedSummaries,
        emailAccount,
        userPersona,
      ).catch((error) => {
        logger.error("Error generating actionable recommendations", { error });
      })
    : null;

  return {
    executiveSummary,
    emailActivityOverview: {
      dataSources: {
        inbox: totalReceived,
        archived: 0,
        trash: 0,
        sent: totalSent,
      },
    },
    userPersona,
    emailBehavior,
    responsePatterns,
    labelAnalysis: {
      currentLabels: gmailLabels.map((label) => ({
        name: label.name,
        emailCount: label.messagesTotal || 0,
        unreadCount: label.messagesUnread || 0,
        threadCount: label.threadsTotal || 0,
        unreadThreads: label.threadsUnread || 0,
        color: label.color || null,
        type: label.type,
      })),
      optimizationSuggestions: labelAnalysis?.optimizationSuggestions || [],
    },
    actionableRecommendations,
  };
}

async function fetchLabels(
  emailProvider: EmailProvider,
  logger: Logger,
): Promise<EmailLabel[]> {
  try {
    const labels = await emailProvider.getLabels({ includeHidden: true });

    const userLabels = labels.filter(
      (label) =>
        label.type === "user" &&
        !label.name.startsWith("CATEGORY_") &&
        !label.name.startsWith("CHAT"),
    );

    const labelsWithCounts = await Promise.all(
      userLabels.map(async (label) => {
        try {
          const labelDetail = await emailProvider.getLabelById(label.id);
          return {
            ...label,
            messagesTotal: labelDetail?.messagesTotal || 0,
            messagesUnread: labelDetail?.messagesUnread || 0,
            threadsTotal: labelDetail?.threadsTotal || 0,
            threadsUnread: labelDetail?.threadsUnread || 0,
          };
        } catch (error) {
          logger.warn("Failed to get details for label", {
            labelName: label.name,
            error,
          });
          return {
            ...label,
            messagesTotal: 0,
            messagesUnread: 0,
            threadsTotal: 0,
            threadsUnread: 0,
          };
        }
      }),
    );

    return labelsWithCounts.sort(
      (a, b) => (b.messagesTotal || 0) - (a.messagesTotal || 0),
    );
  } catch (error) {
    logger.warn("Failed to fetch labels", { error });
    return [];
  }
}

async function fetchSignature(
  emailProvider: EmailProvider,
  logger: Logger,
): Promise<string> {
  try {
    const signatures = await emailProvider.getSignatures();
    const defaultSignature =
      signatures.find((sig) => sig.isDefault) || signatures[0];

    return defaultSignature?.signature || "";
  } catch (error) {
    logger.warn("Failed to fetch signature", { error });
    return "";
  }
}
