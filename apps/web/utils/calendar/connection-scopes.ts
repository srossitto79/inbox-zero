import { CALENDAR_SCOPES as GOOGLE_CALENDAR_SCOPES } from "@/utils/gmail/scopes";
import { CALENDAR_SCOPES as MICROSOFT_CALENDAR_SCOPES } from "@/utils/outlook/scopes";

// Identity scopes: providers do not always echo them back in the granted list.
const IDENTITY_SCOPES = new Set([
  "openid",
  "profile",
  "email",
  "user.read",
  "offline_access",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
]);

const MICROSOFT_GRAPH_PREFIX = "https://graph.microsoft.com/";

export type CalendarConnectionState =
  | "connected"
  | "disconnected"
  | "missing_scopes";

/**
 * Calendar scopes the connection was never consented to. A connection that
 * predates scope tracking has no stored scope, which reads as every scope
 * missing so it is asked to reconnect once.
 */
export function getMissingCalendarScopes({
  provider,
  grantedScope,
}: {
  provider: string;
  grantedScope: string | null | undefined;
}): string[] {
  const required: readonly string[] =
    provider === "microsoft"
      ? MICROSOFT_CALENDAR_SCOPES
      : GOOGLE_CALENDAR_SCOPES;
  const granted = new Set(
    (grantedScope ?? "")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(normalizeScope),
  );

  return required.filter(
    (scope) =>
      !IDENTITY_SCOPES.has(normalizeScope(scope)) &&
      !granted.has(normalizeScope(scope)),
  );
}

export function getCalendarConnectionState(connection: {
  provider: string;
  isConnected: boolean;
  scope: string | null;
}): CalendarConnectionState {
  if (!connection.isConnected) return "disconnected";
  const missing = getMissingCalendarScopes({
    provider: connection.provider,
    grantedScope: connection.scope,
  });
  return missing.length > 0 ? "missing_scopes" : "connected";
}

function normalizeScope(scope: string) {
  const lower = scope.toLowerCase();
  return lower.startsWith(MICROSOFT_GRAPH_PREFIX)
    ? lower.slice(MICROSOFT_GRAPH_PREFIX.length)
    : lower;
}
