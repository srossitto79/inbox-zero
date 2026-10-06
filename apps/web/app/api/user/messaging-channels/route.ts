import { NextResponse } from "next/server";
import prisma from "@/utils/prisma";
import { withEmailAccount } from "@/utils/middleware";
import type { MessagingProvider } from "@/generated/prisma/enums";
import { MessagingRoutePurpose } from "@/generated/prisma/enums";
import {
  isMessagingChannelOperational,
  isOperationalSlackChannel,
} from "@/utils/messaging/channel-validity";
import {
  getAvailableMessagingProviders,
  getEnvConfiguredProviders,
} from "@/utils/messaging/app-credentials";
import { ADMIN_ROLES } from "@/utils/organizations/roles";
import { getMessagingRouteSummary } from "@/utils/messaging/routes";
import { listChannels } from "@/utils/messaging/providers/slack/channels";
import { createSlackClient } from "@/utils/messaging/providers/slack/client";

export type GetMessagingChannelsResponse = Awaited<ReturnType<typeof getData>>;

export const GET = withEmailAccount(
  "user/messaging-channels",
  async (request) => {
    const { emailAccountId, userId } = request.auth;
    const result = await getData({ emailAccountId, userId });
    return NextResponse.json(result);
  },
);

async function getData({
  emailAccountId,
  userId,
}: {
  emailAccountId: string;
  userId: string;
}) {
  const channels = await prisma.messagingChannel.findMany({
    where: { emailAccountId },
    select: {
      id: true,
      provider: true,
      teamName: true,
      teamId: true,
      providerUserId: true,
      accessToken: true,
      isConnected: true,
      routes: {
        select: {
          purpose: true,
          targetType: true,
          targetId: true,
        },
      },
      actions: {
        select: {
          id: true,
          type: true,
          ruleId: true,
          rule: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const slackTargetNamesByChannelId = await getSlackTargetNames(channels);

  return {
    channels: channels.map(
      ({ routes, providerUserId, accessToken: _accessToken, ...channel }) => {
        const isConnected = isMessagingChannelOperational({
          ...channel,
          providerUserId,
          accessToken: _accessToken,
        });

        return {
          ...channel,
          isConnected,
          canSendAsDm: channel.provider === "SLACK" && isConnected,
          destinations: {
            ruleNotifications: getMessagingRouteSummary(
              routes,
              MessagingRoutePurpose.RULE_NOTIFICATIONS,
              slackTargetNamesByChannelId[channel.id],
            ),
            scheduledCheckIns: getMessagingRouteSummary(
              routes,
              MessagingRoutePurpose.SCHEDULED_CHECK_INS,
              slackTargetNamesByChannelId[channel.id],
            ),
            meetingBriefs: getMessagingRouteSummary(
              routes,
              MessagingRoutePurpose.MEETING_BRIEFS,
              slackTargetNamesByChannelId[channel.id],
            ),
            documentFilings: getMessagingRouteSummary(
              routes,
              MessagingRoutePurpose.DOCUMENT_FILINGS,
              slackTargetNamesByChannelId[channel.id],
            ),
            digests: getMessagingRouteSummary(
              routes,
              MessagingRoutePurpose.DIGESTS,
              slackTargetNamesByChannelId[channel.id],
            ),
            followUps: getMessagingRouteSummary(
              routes,
              MessagingRoutePurpose.FOLLOW_UPS,
              slackTargetNamesByChannelId[channel.id],
            ),
          },
        };
      },
    ),
    availableProviders: await getAvailableMessagingProviders(emailAccountId),
    appSetup: await getAppSetup({ emailAccountId, userId }),
  };
}

async function getAppSetup({
  emailAccountId,
  userId,
}: {
  emailAccountId: string;
  userId: string;
}) {
  const accountMembership = await prisma.member.findFirst({
    where: { emailAccountId },
    select: { organizationId: true },
  });
  const organizationId = accountMembership?.organizationId ?? null;

  const [adminMembership, storedConfigs] = await Promise.all([
    organizationId
      ? prisma.member.findFirst({
          where: {
            organizationId,
            emailAccount: { userId },
            role: { in: ADMIN_ROLES },
          },
          select: { role: true },
        })
      : null,
    organizationId
      ? prisma.messagingAppConfig.findMany({
          where: { organizationId },
          select: { provider: true },
        })
      : [],
  ]);

  return {
    organizationId,
    canEdit: Boolean(adminMembership),
    envProviders: getEnvConfiguredProviders(),
    storedProviders: storedConfigs.map((config) => config.provider),
  };
}

async function getSlackTargetNames(
  channels: Array<{
    id: string;
    provider: MessagingProvider;
    isConnected: boolean;
    accessToken: string | null;
    providerUserId: string | null;
  }>,
) {
  const targetNamesByChannelId: Record<string, Record<string, string>> = {};

  const channelIdsByToken = new Map<string, string[]>();
  for (const channel of channels.filter(isOperationalSlackChannel)) {
    const accessToken = channel.accessToken;
    if (!accessToken) continue;
    const channelIds = channelIdsByToken.get(accessToken) ?? [];
    channelIds.push(channel.id);
    channelIdsByToken.set(accessToken, channelIds);
  }

  await Promise.all(
    Array.from(channelIdsByToken.entries()).map(
      async ([accessToken, channelIds]) => {
        try {
          const client = createSlackClient(accessToken);
          const targets = await listChannels(client);
          const targetNames = Object.fromEntries(
            targets.map((target) => [target.id, `#${target.name}`]),
          );
          for (const channelId of channelIds) {
            targetNamesByChannelId[channelId] = targetNames;
          }
        } catch {
          // Leave channelId unset so callers fall back to the raw target id.
        }
      },
    ),
  );

  return targetNamesByChannelId;
}
