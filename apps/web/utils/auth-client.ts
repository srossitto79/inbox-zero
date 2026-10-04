import { createAuthClient } from "better-auth/react";
import { ssoClient } from "@better-auth/sso/client";
import { emailOTPClient, organizationClient } from "better-auth/client/plugins";
import { apiPath } from "@/utils/api-path";

export const {
  signIn,
  signOut,
  signUp,
  useSession,
  getSession,
  sso,
  emailOtp,
} = createAuthClient({
  // Under a Next.js basePath the client must call the prefixed auth routes.
  baseURL: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth`,
  plugins: [ssoClient(), organizationClient(), emailOTPClient()],
});

export async function signInWithSocialRedirect(
  options: Parameters<typeof signIn.social>[0],
) {
  const response = await fetch(apiPath("/api/auth/sign-in/social"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ ...options, disableRedirect: true }),
  });

  const payload = await parseOauth2Response(response);
  if (!response.ok) {
    throw new Error(
      payload.error || `Request failed with status ${response.status}`,
    );
  }

  return payload;
}

async function parseOauth2Response(response: Response) {
  try {
    const data = (await response.json()) as {
      url?: string;
      message?: string;
      error?: string;
    };

    return {
      url: data.url,
      error: data.error || data.message,
    };
  } catch {
    return {
      error: `Request failed with status ${response.status}`,
    };
  }
}
