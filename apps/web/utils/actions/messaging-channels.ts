"use server";

import { actionClient } from "@/utils/actions/safe-action";
import {
  updateSlackRouteBody,
  updateMessagingFeatureRouteBody,
  updateMeetingBriefsEmailDeliveryBody,
  updateDigestEmailDeliveryBody,
  disconnectChannelBody,
  linkSlackWorkspaceBody,
  createMessagingLinkCodeBody,
  toggleRuleChannelBody,
  saveMessagingAppConfigBody,
  deleteMessagingAppConfigBody,
  type MessagingAppProvider,
} from "@/utils/actions/messaging-channels.validation";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import { RULE_MANAGED_BY_ORGANIZATION_ERROR } from "@/utils/organizations/rules";
import { isNotFoundError } from "@/utils/prisma-helpers";
import {
  ActionType,
  MessagingProvider,
  MessagingRoutePurpose,
  type MessagingRouteTargetType,
} from "@/generated/prisma/enums";
import { generateMessagingLinkCode } from "@/utils/messaging/chat-sdk/link-code";
import {
  resolveTeamsBotCredentials,
  resolveTelegramBotCredentials,
} from "@/utils/messaging/app-credentials";
import { invalidateMessagingAdapterHydration } from "@/utils/messaging/chat-sdk/adapter-hydration";
import { fetchAndCheckIsAdmin } from "@/utils/organizations/access";
import {
  DRAFT_REPLY_ACTION_TYPES,
  MESSAGING_CHANNEL_ACTION_TYPES,
} from "@/utils/actions/draft-reply";
import {
  getMessagingChannelReconnectMessage,
  isOperationalSlackChannel,
  isMessagingChannelOperational,
} from "@/utils/messaging/channel-validity";
import {
  getMessagingRoute,
  hasMessagingRoute,
  type MessagingFeatureRoutePurpose,
} from "@/utils/messaging/routes";
import { createSlackClient } from "@/utils/messaging/providers/slack/client";
import { upsertSlackRoute } from "@/utils/messaging/slack-routes";
import { sendSlackOnboardingDirectMessageWithLogging } from "@/utils/messaging/providers/slack/send-onboarding-direct-message";
import { lookupSlackUserByEmail } from "@/utils/messaging/providers/slack/users";
import { callTelegramBotApi } from "@/utils/messaging/providers/telegram/api";
import { assertCanUseDigests } from "@/utils/premium/server";

export const updateSlackRouteAction = actionClient
  .metadata({ name: "updateSlackRoute" })
  .inputSchema(updateSlackRouteBody)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { channelId, purpose, targetId },
    }) => {
      const where = {
        id_emailAccountId: { id: channelId, emailAccountId },
      };

      const channel = await prisma.messagingChannel.findUnique({
        where,
        select: {
          id: true,
          provider: true,
          isConnected: true,
          accessToken: true,
          providerUserId: true,
          botUserId: true,
        },
      });

      if (!channel) {
        throw new SafeError("Messaging channel not found");
      }

      if (channel.provider !== MessagingProvider.SLACK) {
        throw new SafeError("Messaging channel is not Slack");
      }

      if (!isOperationalSlackChannel(channel)) {
        throw new SafeError(
          getMessagingChannelReconnectMessage(channel.provider),
        );
      }

      await upsertSlackRoute({
        messagingChannelId: channelId,
        purpose,
        targetId,
        accessToken: channel.accessToken,
        providerUserId: channel.providerUserId,
        botUserId: channel.botUserId,
        logger,
      });
    },
  );

export const updateMessagingFeatureRouteAction = actionClient
  .metadata({ name: "updateMessagingFeatureRoute" })
  .inputSchema(updateMessagingFeatureRouteBody)
  .action(
    async ({
      ctx: { emailAccountId, userId },
      parsedInput: { channelId, purpose, enabled },
    }) => {
      if (enabled && purpose === MessagingRoutePurpose.DIGESTS) {
        await assertCanUseDigests(userId);
      }

      const where = {
        id_emailAccountId: { id: channelId, emailAccountId },
      };

      const channel = await prisma.messagingChannel.findUnique({
        where,
        select: {
          id: true,
          provider: true,
          isConnected: true,
          accessToken: true,
          providerUserId: true,
          routes: {
            select: {
              purpose: true,
              targetType: true,
              targetId: true,
            },
          },
        },
      });

      if (!channel) {
        throw new SafeError("Messaging channel not found");
      }

      if (!isMessagingChannelOperational(channel)) {
        throw new SafeError(
          getMessagingChannelReconnectMessage(channel.provider),
        );
      }

      await syncMessagingFeatureRoute({
        messagingChannelId: channel.id,
        routes: channel.routes,
        purpose,
        enabled,
      });
    },
  );

export const updateMeetingBriefsEmailDeliveryAction = actionClient
  .metadata({ name: "updateMeetingBriefsEmailDelivery" })
  .inputSchema(updateMeetingBriefsEmailDeliveryBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { sendEmail } }) => {
    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { meetingBriefsSendEmail: sendEmail },
    });
  });

export const updateDigestEmailDeliveryAction = actionClient
  .metadata({ name: "updateDigestEmailDelivery" })
  .inputSchema(updateDigestEmailDeliveryBody)
  .action(
    async ({ ctx: { emailAccountId, userId }, parsedInput: { sendEmail } }) => {
      if (sendEmail) {
        await assertCanUseDigests(userId);
      }

      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: { digestSendEmail: sendEmail },
      });
    },
  );

export const disconnectChannelAction = actionClient
  .metadata({ name: "disconnectChannel" })
  .inputSchema(disconnectChannelBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { channelId } }) => {
    try {
      await prisma.messagingChannel.update({
        where: {
          id_emailAccountId: {
            id: channelId,
            emailAccountId,
          },
        },
        data: {
          isConnected: false,
          routes: {
            deleteMany: {},
          },
        },
      });
    } catch (error) {
      if (isNotFoundError(error))
        throw new SafeError("Messaging channel not found");
      throw error;
    }
  });

export const linkSlackWorkspaceAction = actionClient
  .metadata({ name: "linkSlackWorkspace" })
  .inputSchema(linkSlackWorkspaceBody)
  .action(
    async ({
      ctx: { emailAccountId, emailAccount, logger },
      parsedInput: { teamId },
    }) => {
      const existing = await prisma.messagingChannel.findUnique({
        where: {
          emailAccountId_provider_teamId: {
            emailAccountId,
            provider: MessagingProvider.SLACK,
            teamId,
          },
        },
      });
      if (existing?.isConnected) {
        throw new SafeError("Workspace already connected");
      }

      const orgMateChannel = await prisma.messagingChannel.findFirst({
        where: {
          provider: MessagingProvider.SLACK,
          teamId,
          isConnected: true,
          accessToken: { not: null },
          NOT: { emailAccountId },
          emailAccount: {
            members: {
              some: {
                organization: {
                  members: { some: { emailAccountId } },
                },
              },
            },
          },
        },
        select: {
          accessToken: true,
          botUserId: true,
          teamName: true,
        },
      });

      if (!orgMateChannel?.accessToken) {
        throw new SafeError(
          "No connected workspace found in your organization",
        );
      }

      const client = createSlackClient(orgMateChannel.accessToken);
      const slackUser = await lookupSlackUserByEmail(
        client,
        emailAccount.email,
      );

      if (!slackUser) {
        throw new SafeError(
          "Could not find your Slack account. Your Inbox Zero email may not match your Slack profile email.",
        );
      }

      await prisma.messagingChannel.upsert({
        where: {
          emailAccountId_provider_teamId: {
            emailAccountId,
            provider: MessagingProvider.SLACK,
            teamId,
          },
        },
        update: {
          teamName: orgMateChannel.teamName,
          accessToken: orgMateChannel.accessToken,
          providerUserId: slackUser.id,
          botUserId: orgMateChannel.botUserId,
          isConnected: true,
        },
        create: {
          provider: MessagingProvider.SLACK,
          teamId,
          teamName: orgMateChannel.teamName,
          accessToken: orgMateChannel.accessToken,
          providerUserId: slackUser.id,
          botUserId: orgMateChannel.botUserId,
          emailAccountId,
          isConnected: true,
        },
      });

      await sendSlackOnboardingDirectMessageWithLogging({
        accessToken: orgMateChannel.accessToken,
        userId: slackUser.id,
        botUserId: orgMateChannel.botUserId,
        teamId,
        logger,
      });

      logger.info("Slack workspace linked via org-mate token", { teamId });
    },
  );

export const createMessagingLinkCodeAction = actionClient
  .metadata({ name: "createMessagingLinkCode" })
  .inputSchema(createMessagingLinkCodeBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput: { provider } }) => {
    let botUrl: string | undefined;

    if (provider === "TEAMS") {
      const credentials = await resolveTeamsBotCredentials(emailAccountId);
      if (!credentials) {
        throw new SafeError("Teams integration is not configured");
      }
      botUrl = getTeamsBotUrl(credentials);
    } else {
      const credentials = await resolveTelegramBotCredentials(emailAccountId);
      if (!credentials) {
        throw new SafeError("Telegram integration is not configured");
      }
      botUrl = await getTelegramBotUrl(credentials.botToken);
    }

    const code = generateMessagingLinkCode({
      emailAccountId,
      provider,
    });

    return {
      code,
      provider,
      expiresInSeconds: 10 * 60,
      ...(botUrl ? { botUrl } : {}),
    };
  });

export const toggleRuleChannelAction = actionClient
  .metadata({ name: "toggleRuleChannel" })
  .inputSchema(toggleRuleChannelBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: {
        ruleId,
        messagingChannelId,
        enabled,
        actionType: requestedType,
      },
    }) => {
      const [rule, channel] = await Promise.all([
        prisma.rule.findUnique({
          where: {
            id_emailAccountId: {
              id: ruleId,
              emailAccountId,
            },
          },
          select: {
            organizationRuleId: true,
            actions: {
              where: { type: { in: [...DRAFT_REPLY_ACTION_TYPES] } },
              select: { id: true },
              take: 1,
            },
          },
        }),
        prisma.messagingChannel.findUnique({
          where: {
            id_emailAccountId: {
              id: messagingChannelId,
              emailAccountId,
            },
          },
          select: {
            isConnected: true,
            provider: true,
            accessToken: true,
            providerUserId: true,
            routes: {
              select: {
                purpose: true,
                targetType: true,
                targetId: true,
              },
            },
          },
        }),
      ]);

      if (!rule) {
        throw new SafeError("Rule not found");
      }
      if (rule.organizationRuleId) {
        throw new SafeError(RULE_MANAGED_BY_ORGANIZATION_ERROR);
      }
      if (!channel) {
        throw new SafeError("Messaging channel not found");
      }

      let actionType: ActionType =
        requestedType ?? ActionType.NOTIFY_MESSAGING_CHANNEL;
      const hasDraftReplyAction = (rule.actions?.length ?? 0) > 0;
      if (
        actionType === ActionType.DRAFT_MESSAGING_CHANNEL &&
        !hasDraftReplyAction
      ) {
        actionType = ActionType.NOTIFY_MESSAGING_CHANNEL;
      }

      if (enabled) {
        if (!isMessagingChannelOperational(channel)) {
          throw new SafeError(
            getMessagingChannelReconnectMessage(channel.provider),
          );
        }
        if (
          !hasMessagingRoute(
            channel.routes,
            MessagingRoutePurpose.RULE_NOTIFICATIONS,
          )
        ) {
          throw new SafeError(
            "Please select a target channel before enabling notifications",
          );
        }

        await prisma.action.deleteMany({
          where: {
            ruleId,
            messagingChannelId,
            type: { in: [...MESSAGING_CHANNEL_ACTION_TYPES] },
          },
        });

        await prisma.action.create({
          data: {
            type: actionType,
            ruleId,
            messagingChannelId,
            emailAccountId,
            messagingChannelEmailAccountId: emailAccountId,
          },
        });
      } else {
        await prisma.action.deleteMany({
          where: {
            ruleId,
            messagingChannelId,
            type: { in: [...MESSAGING_CHANNEL_ACTION_TYPES] },
          },
        });
      }
    },
  );

export const saveMessagingAppConfigAction = actionClient
  .metadata({ name: "saveMessagingAppConfig" })
  .inputSchema(saveMessagingAppConfigBody)
  .action(async ({ ctx: { emailAccountId, userId, logger }, parsedInput }) => {
    const { provider, ...fields } = parsedInput;

    const organizationId = await requireOrgAdmin({ emailAccountId, userId });

    const existing = await prisma.messagingAppConfig.findUnique({
      where: { organizationId_provider: { organizationId, provider } },
    });

    const merged = {
      clientId: fields.clientId ?? existing?.clientId,
      clientSecret: fields.clientSecret ?? existing?.clientSecret,
      signingSecret: fields.signingSecret ?? existing?.signingSecret,
      appId: fields.appId ?? existing?.appId,
      appPassword: fields.appPassword ?? existing?.appPassword,
      tenantId: fields.tenantId ?? existing?.tenantId,
      botToken: fields.botToken ?? existing?.botToken,
      botSecretToken: fields.botSecretToken ?? existing?.botSecretToken,
    };

    const missing = getMissingAppConfigFields(provider, merged);
    if (missing.length > 0) {
      throw new SafeError(
        `Missing required fields for ${provider}: ${missing.join(", ")}`,
      );
    }

    await prisma.messagingAppConfig.upsert({
      where: { organizationId_provider: { organizationId, provider } },
      // Only the submitted fields change so admins can rotate one secret.
      update: fields,
      create: { organizationId, provider, ...merged },
    });

    await invalidateMessagingAdapterHydration();

    logger.info("Messaging app config saved", { organizationId, provider });
  });

export const deleteMessagingAppConfigAction = actionClient
  .metadata({ name: "deleteMessagingAppConfig" })
  .inputSchema(deleteMessagingAppConfigBody)
  .action(async ({ ctx: { emailAccountId, userId, logger }, parsedInput }) => {
    const { provider } = parsedInput;

    const organizationId = await requireOrgAdmin({ emailAccountId, userId });

    await prisma.messagingAppConfig.deleteMany({
      where: { organizationId, provider },
    });

    await invalidateMessagingAdapterHydration();

    logger.info("Messaging app config deleted", { organizationId, provider });
  });

async function getTelegramBotUrl(botToken: string) {
  try {
    const result = await callTelegramBotApi<{ username?: string }>({
      botToken,
      apiMethod: "getMe",
      requestMethod: "GET",
    });

    const username = result.username?.trim().replace(/^@+/, "");
    if (!username) return;

    return `https://t.me/${username}`;
  } catch {
    return;
  }
}

function getTeamsBotUrl(credentials: { appId: string; tenantId?: string }) {
  const url = new URL(`https://teams.microsoft.com/l/app/${credentials.appId}`);

  if (credentials.tenantId) {
    url.searchParams.set("tenantId", credentials.tenantId);
  }

  return url.toString();
}

async function syncMessagingFeatureRoute({
  messagingChannelId,
  routes,
  purpose,
  enabled,
}: {
  messagingChannelId: string;
  routes: Array<{
    purpose: MessagingRoutePurpose;
    targetType: MessagingRouteTargetType;
    targetId: string;
  }>;
  purpose: MessagingFeatureRoutePurpose;
  enabled: boolean;
}) {
  if (!enabled) {
    await prisma.messagingRoute.deleteMany({
      where: {
        messagingChannelId,
        purpose,
      },
    });
    return;
  }

  const featureRoute = getMessagingRoute(routes, purpose);
  if (featureRoute) return;

  const rulesRoute = getMessagingRoute(
    routes,
    MessagingRoutePurpose.RULE_NOTIFICATIONS,
  );

  if (!rulesRoute) {
    throw new SafeError(
      "Please select a target channel before enabling features",
    );
  }

  await prisma.messagingRoute.create({
    data: {
      messagingChannelId,
      purpose,
      targetType: rulesRoute.targetType,
      targetId: rulesRoute.targetId,
    },
  });
}

async function requireOrgAdmin({
  emailAccountId,
  userId,
}: {
  emailAccountId: string;
  userId?: string;
}) {
  if (!userId) throw new SafeError("Not authenticated");

  const membership = await prisma.member.findFirst({
    where: { emailAccountId },
    select: { organizationId: true },
  });
  if (!membership) {
    throw new SafeError(
      "You must belong to an organization to configure messaging apps",
    );
  }

  await fetchAndCheckIsAdmin({
    organizationId: membership.organizationId,
    userId,
  });

  return membership.organizationId;
}

function getMissingAppConfigFields(
  provider: MessagingAppProvider,
  config: Record<string, string | null | undefined>,
): string[] {
  const requiredFields: Record<MessagingAppProvider, string[]> = {
    SLACK: ["clientId", "clientSecret", "signingSecret"],
    TEAMS: ["appId", "appPassword", "tenantId"],
    TELEGRAM: ["botToken", "botSecretToken"],
  };

  return requiredFields[provider].filter((field) => !config[field]);
}
