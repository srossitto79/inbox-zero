import { env } from "@/env";
import { withError } from "@/utils/middleware";
import { handleMessagingWebhookRoute } from "@/utils/messaging/chat-sdk/webhook-route";
import { hasAnyMessagingAppConfig } from "@/utils/messaging/app-credentials";

export const maxDuration = 120;

export const POST = withError("telegram/events", async (request) =>
  handleMessagingWebhookRoute({
    request,
    platform: "telegram",
    isConfigured:
      Boolean(env.TELEGRAM_BOT_TOKEN) ||
      (await hasAnyMessagingAppConfig("TELEGRAM")),
    notConfiguredError: "Telegram not configured",
    adapterUnavailableError: "Telegram adapter unavailable",
    webhookUnavailableError: "Telegram webhook unavailable",
  }),
);
