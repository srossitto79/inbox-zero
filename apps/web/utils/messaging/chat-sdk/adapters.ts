import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createTeamsAdapter, type TeamsAdapter } from "@chat-adapter/teams";
import {
  createTelegramAdapter,
  type TelegramAdapter,
} from "@chat-adapter/telegram";
import type { Adapter } from "chat";
import { env } from "@/env";
import type { AdapterConfigs } from "@/utils/messaging/app-credentials";

export type MessagingAdapters = {
  slack?: SlackAdapter;
  teams?: TeamsAdapter;
  telegram?: TelegramAdapter;
};

type MessagingAdapterRegistry = {
  adapters: Record<string, Adapter>;
  typedAdapters: MessagingAdapters;
};

/** Thrown when neither env nor stored configs provide any platform credentials;
 * callers treat it as "messaging not set up" rather than a malfunction. */
export class NoMessagingAdaptersError extends Error {
  constructor() {
    super(
      "No messaging adapters configured. Configure Slack, Teams, or Telegram credentials.",
    );
    this.name = "NoMessagingAdaptersError";
  }
}

declare global {
  var inboxZeroMessagingAdapterRegistry: MessagingAdapterRegistry | undefined;
}

export function getMessagingAdapterRegistry(): MessagingAdapterRegistry {
  if (!global.inboxZeroMessagingAdapterRegistry) {
    global.inboxZeroMessagingAdapterRegistry = createMessagingAdapterRegistry();
  }

  return global.inboxZeroMessagingAdapterRegistry;
}

export function resetMessagingAdapterRegistry() {
  global.inboxZeroMessagingAdapterRegistry = undefined;
}

export function createMessagingAdapterRegistry(
  dbConfigs?: AdapterConfigs,
): MessagingAdapterRegistry {
  const adapters: Record<string, Adapter> = {};
  const typedAdapters: MessagingAdapters = {};

  // Env wins per platform so an operator can override in-app configs.
  const signingSecret =
    env.SLACK_SIGNING_SECRET ?? dbConfigs?.slack?.signingSecret;
  if (signingSecret) {
    const slackAdapterConfig: Parameters<typeof createSlackAdapter>[0] = {
      signingSecret,
    };

    if (env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET) {
      slackAdapterConfig.clientId = env.SLACK_CLIENT_ID;
      slackAdapterConfig.clientSecret = env.SLACK_CLIENT_SECRET;
    }

    const slackAdapter = createSlackAdapter(slackAdapterConfig);
    adapters.slack = slackAdapter;
    typedAdapters.slack = slackAdapter;
  }

  const teamsCredentials =
    env.TEAMS_BOT_APP_ID &&
    env.TEAMS_BOT_APP_PASSWORD &&
    env.TEAMS_BOT_APP_TENANT_ID
      ? {
          appId: env.TEAMS_BOT_APP_ID,
          appPassword: env.TEAMS_BOT_APP_PASSWORD,
          appTenantId: env.TEAMS_BOT_APP_TENANT_ID,
        }
      : dbConfigs?.teams
        ? {
            appId: dbConfigs.teams.appId,
            appPassword: dbConfigs.teams.appPassword,
            appTenantId: dbConfigs.teams.tenantId,
          }
        : undefined;
  if (teamsCredentials) {
    const teamsAdapter = createTeamsAdapter({
      ...teamsCredentials,
      appType: "SingleTenant",
    });

    adapters.teams = teamsAdapter;
    typedAdapters.teams = teamsAdapter;
  }

  const telegramBotToken =
    env.TELEGRAM_BOT_TOKEN ?? dbConfigs?.telegram?.botToken;
  const telegramSecretToken =
    env.TELEGRAM_BOT_SECRET_TOKEN ?? dbConfigs?.telegram?.secretToken;
  if (telegramBotToken) {
    const telegramAdapter = createTelegramAdapter({
      botToken: telegramBotToken,
      secretToken: telegramSecretToken,
    });

    adapters.telegram = telegramAdapter;
    typedAdapters.telegram = telegramAdapter;
  }

  if (!Object.keys(adapters).length) {
    throw new NoMessagingAdaptersError();
  }

  return { adapters, typedAdapters };
}
