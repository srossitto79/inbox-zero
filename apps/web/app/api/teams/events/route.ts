import { withError } from "@/utils/middleware";
import { isTeamsBotConfigured } from "@/utils/messaging/chat-sdk/teams-config";
import { handleMessagingWebhookRoute } from "@/utils/messaging/chat-sdk/webhook-route";
import { hasAnyMessagingAppConfig } from "@/utils/messaging/app-credentials";

export const maxDuration = 120;

export const POST = withError("teams/events", async (request) =>
  handleMessagingWebhookRoute({
    request,
    platform: "teams",
    isConfigured:
      isTeamsBotConfigured() || (await hasAnyMessagingAppConfig("TEAMS")),
    notConfiguredError: "Teams not configured",
    adapterUnavailableError: "Teams adapter unavailable",
    webhookUnavailableError: "Teams webhook unavailable",
  }),
);
