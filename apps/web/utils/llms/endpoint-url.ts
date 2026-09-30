import { Provider } from "@/utils/llms/config";
import type { UserAIFields } from "@/utils/llms/types";

/**
 * Returns the endpoint without trailing slashes, or null when it is not an
 * http(s) URL or carries credentials.
 */
export function normalizeEndpointUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  return url.toString().replace(/\/+$/, "");
}

export function hasUserCustomEndpoint(
  userAi: Pick<UserAIFields, "aiProvider" | "aiBaseUrl">,
) {
  return (
    userAi.aiProvider === Provider.OPENAI_COMPATIBLE &&
    !!userAi.aiBaseUrl?.trim()
  );
}
