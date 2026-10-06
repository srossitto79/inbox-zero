import { NextResponse } from "next/server";
import { env } from "@/env";
import { withEmailAccount } from "@/utils/middleware";
import prisma from "@/utils/prisma";
import { MessagingProvider } from "@/generated/prisma/enums";
import {
  getSlackRedirectUri,
  resolveSlackAppCredentials,
} from "@/utils/messaging/app-credentials";
import {
  SLACK_STATE_COOKIE_NAME,
  SLACK_OAUTH_STATE_TYPE,
  SLACK_SCOPES,
} from "@/utils/messaging/providers/slack/constants";
import {
  generateSignedOAuthState,
  oauthStateCookieOptions,
} from "@/utils/oauth/state";

export type GetSlackAuthUrlResponse = {
  url: string;
  existingWorkspace?: { teamId: string; teamName: string };
};

export const GET = withEmailAccount("slack/auth-url", async (request) => {
  const { emailAccountId } = request.auth;

  const credentials = await resolveSlackAppCredentials(emailAccountId);
  if (!credentials) {
    return NextResponse.json(
      { error: "Slack integration not configured" },
      { status: 503 },
    );
  }

  const { url, state, redirectUri } = getAuthUrl({
    emailAccountId,
    clientId: credentials.clientId,
  });

  const existingWorkspace = await findOrgMateWorkspace(emailAccountId);

  request.logger.info("Slack auth URL generated", {
    redirectUri,
    clientId: credentials.clientId,
    baseUrl: env.NEXT_PUBLIC_BASE_URL,
    webhookUrl: env.WEBHOOK_URL ?? null,
    hasExistingWorkspace: !!existingWorkspace,
  });

  const res: GetSlackAuthUrlResponse = existingWorkspace
    ? { url, existingWorkspace }
    : { url };
  const response = NextResponse.json(res);

  response.cookies.set(SLACK_STATE_COOKIE_NAME, state, oauthStateCookieOptions);

  return response;
});

function getAuthUrl({
  emailAccountId,
  clientId,
}: {
  emailAccountId: string;
  clientId: string;
}) {
  const state = generateSignedOAuthState({
    emailAccountId,
    type: SLACK_OAUTH_STATE_TYPE,
  });

  const redirectUri = getSlackRedirectUri();

  const params = new URLSearchParams({
    client_id: clientId,
    scope: SLACK_SCOPES,
    redirect_uri: redirectUri,
    state,
  });

  const url = `https://slack.com/oauth/v2/authorize?${params.toString()}`;

  return { url, state, redirectUri };
}

async function findOrgMateWorkspace(
  emailAccountId: string,
): Promise<{ teamId: string; teamName: string } | null> {
  const channel = await prisma.messagingChannel.findFirst({
    where: {
      provider: MessagingProvider.SLACK,
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
    select: { teamId: true, teamName: true },
  });

  if (!channel) return null;
  return {
    teamId: channel.teamId,
    teamName: channel.teamName ?? "Slack workspace",
  };
}
