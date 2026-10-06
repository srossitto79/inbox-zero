import { env } from "@/env";
import prisma from "@/utils/prisma";
import type { MessagingProvider } from "@/generated/prisma/enums";

export type SlackAppCredentials = {
  clientId: string;
  clientSecret: string;
  signingSecret: string | null;
};

export type TeamsBotCredentials = {
  appId: string;
  appPassword: string;
  tenantId: string;
};

export type TelegramBotCredentials = {
  botToken: string;
  botSecretToken: string | null;
};

export type AdapterConfigs = {
  slack?: { signingSecret: string };
  teams?: { appId: string; appPassword: string; tenantId: string };
  telegram?: { botToken: string; secretToken: string };
};

/**
 * Two resolution scopes:
 * - Org-scoped (OAuth flows bound to an email account): the organization's
 *   in-app config wins, env is the fallback for org-less setups.
 * - Deployment-scoped (webhook verification, adapter singletons): env wins,
 *   stored configs only fill platforms env leaves empty, so an operator can
 *   always override the in-app config with env vars.
 */

/** Must be identical in the auth-url and callback legs; Slack rejects any mismatch. */
export function getSlackRedirectUri(): string {
  return `${env.WEBHOOK_URL || env.NEXT_PUBLIC_BASE_URL}/api/slack/callback`;
}

export async function getOrganizationIdForEmailAccount(
  emailAccountId: string,
): Promise<string | null> {
  const membership = await getMessagingMembership(emailAccountId);
  return membership?.organizationId ?? null;
}

export async function getMessagingMembership(emailAccountId: string) {
  return prisma.member.findFirst({
    where: { emailAccountId },
    select: { organizationId: true, role: true },
  });
}

async function getStoredConfig(
  emailAccountId: string,
  provider: MessagingProvider,
) {
  const organizationId = await getOrganizationIdForEmailAccount(emailAccountId);
  if (!organizationId) return null;

  return prisma.messagingAppConfig.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
  });
}

export async function resolveSlackAppCredentials(
  emailAccountId: string,
): Promise<SlackAppCredentials | null> {
  return slackCredentials(await getStoredConfig(emailAccountId, "SLACK"));
}

export async function resolveTeamsBotCredentials(
  emailAccountId: string,
): Promise<TeamsBotCredentials | null> {
  return teamsCredentials(await getStoredConfig(emailAccountId, "TEAMS"));
}

export async function resolveTelegramBotCredentials(
  emailAccountId: string,
): Promise<TelegramBotCredentials | null> {
  return telegramCredentials(await getStoredConfig(emailAccountId, "TELEGRAM"));
}

export async function getAvailableMessagingProviders(
  emailAccountId: string,
): Promise<MessagingProvider[]> {
  const organizationId = await getOrganizationIdForEmailAccount(emailAccountId);
  const storedConfigs = organizationId
    ? await prisma.messagingAppConfig.findMany({ where: { organizationId } })
    : [];
  const storedByProvider = new Map(
    storedConfigs.map((config) => [config.provider, config]),
  );

  const providers: MessagingProvider[] = [];
  if (slackCredentials(storedByProvider.get("SLACK") ?? null)) {
    providers.push("SLACK");
  }
  if (teamsCredentials(storedByProvider.get("TEAMS") ?? null)) {
    providers.push("TEAMS");
  }
  if (telegramCredentials(storedByProvider.get("TELEGRAM") ?? null)) {
    providers.push("TELEGRAM");
  }

  return providers;
}

export async function hasAnyMessagingAppConfig(
  provider: MessagingProvider,
): Promise<boolean> {
  const config = await prisma.messagingAppConfig.findFirst({
    where: { provider },
  });
  return Boolean(config);
}

/** Providers the server env alone enables, for surfacing "managed via env" state. */
export function getEnvConfiguredProviders(): MessagingProvider[] {
  const providers: MessagingProvider[] = [];
  if (slackCredentials(null)) providers.push("SLACK");
  if (teamsCredentials(null)) providers.push("TEAMS");
  if (telegramCredentials(null)) providers.push("TELEGRAM");
  return providers;
}

export async function resolvePrimarySlackSigningSecret(): Promise<
  string | null
> {
  if (env.SLACK_SIGNING_SECRET) return env.SLACK_SIGNING_SECRET;

  const config = await prisma.messagingAppConfig.findFirst({
    where: { provider: "SLACK", signingSecret: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  return config?.signingSecret ?? null;
}

/**
 * Configs for platforms env does not already cover, oldest config first so a
 * multi-org deployment deterministically activates the first bot registered.
 */
export async function loadAdapterConfigs(): Promise<AdapterConfigs> {
  const needsSlack = !env.SLACK_SIGNING_SECRET;
  const needsTeams = !(
    env.TEAMS_BOT_APP_ID &&
    env.TEAMS_BOT_APP_PASSWORD &&
    env.TEAMS_BOT_APP_TENANT_ID
  );
  const needsTelegram = !env.TELEGRAM_BOT_TOKEN;
  if (!needsSlack && !needsTeams && !needsTelegram) return {};

  const configs = await prisma.messagingAppConfig.findMany({
    orderBy: { createdAt: "asc" },
  });

  const adapterConfigs: AdapterConfigs = {};

  if (needsSlack) {
    const slack = configs.find(
      (config) => config.provider === "SLACK" && config.signingSecret,
    );
    if (slack?.signingSecret) {
      adapterConfigs.slack = { signingSecret: slack.signingSecret };
    }
  }

  if (needsTeams) {
    const teams = configs.find(
      (config) =>
        config.provider === "TEAMS" &&
        config.appId &&
        config.appPassword &&
        config.tenantId,
    );
    if (teams?.appId && teams.appPassword && teams.tenantId) {
      adapterConfigs.teams = {
        appId: teams.appId,
        appPassword: teams.appPassword,
        tenantId: teams.tenantId,
      };
    }
  }

  if (needsTelegram) {
    const telegram = configs.find(
      (config) =>
        config.provider === "TELEGRAM" &&
        config.botToken &&
        config.botSecretToken,
    );
    if (telegram?.botToken && telegram.botSecretToken) {
      adapterConfigs.telegram = {
        botToken: telegram.botToken,
        secretToken: telegram.botSecretToken,
      };
    }
  }

  return adapterConfigs;
}

function slackCredentials(
  stored: {
    clientId: string | null;
    clientSecret: string | null;
    signingSecret: string | null;
  } | null,
): SlackAppCredentials | null {
  if (stored?.clientId && stored.clientSecret) {
    return {
      clientId: stored.clientId,
      clientSecret: stored.clientSecret,
      signingSecret: stored.signingSecret,
    };
  }

  if (env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET) {
    return {
      clientId: env.SLACK_CLIENT_ID,
      clientSecret: env.SLACK_CLIENT_SECRET,
      signingSecret: env.SLACK_SIGNING_SECRET ?? null,
    };
  }

  return null;
}

function teamsCredentials(
  stored: {
    appId: string | null;
    appPassword: string | null;
    tenantId: string | null;
  } | null,
): TeamsBotCredentials | null {
  if (stored?.appId && stored.appPassword && stored.tenantId) {
    return {
      appId: stored.appId,
      appPassword: stored.appPassword,
      tenantId: stored.tenantId,
    };
  }

  if (
    env.TEAMS_BOT_APP_ID &&
    env.TEAMS_BOT_APP_PASSWORD &&
    env.TEAMS_BOT_APP_TENANT_ID
  ) {
    return {
      appId: env.TEAMS_BOT_APP_ID,
      appPassword: env.TEAMS_BOT_APP_PASSWORD,
      tenantId: env.TEAMS_BOT_APP_TENANT_ID,
    };
  }

  return null;
}

function telegramCredentials(
  stored: {
    botToken: string | null;
    botSecretToken: string | null;
  } | null,
): TelegramBotCredentials | null {
  if (stored?.botToken && stored.botSecretToken) {
    return {
      botToken: stored.botToken,
      botSecretToken: stored.botSecretToken,
    };
  }

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_SECRET_TOKEN) {
    return {
      botToken: env.TELEGRAM_BOT_TOKEN,
      botSecretToken: env.TELEGRAM_BOT_SECRET_TOKEN,
    };
  }

  return null;
}
