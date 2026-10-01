"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/providers/EmailAccountProvider";
import { toastError } from "@/components/Toast";
import { captureException } from "@/utils/error";
import type { GetCalendarAuthUrlResponse } from "@/app/api/google/calendar/auth-url/route";
import { fetchWithAccount } from "@/utils/fetch";
import { CALENDAR_ONBOARDING_RETURN_COOKIE } from "@/utils/calendar/constants";
import { useProductAnalytics } from "@/hooks/useProductAnalytics";
import type { AppPage } from "@/utils/analytics/product";
import { redirectToSafeUrl } from "@/utils/redirect";

export function ConnectCalendar({
  analyticsPage,
  onboardingReturnPath,
  provider,
  reconnect = false,
}: {
  analyticsPage?: AppPage;
  onboardingReturnPath?: string;
  provider?: "google" | "microsoft";
  reconnect?: boolean;
}) {
  const { emailAccountId } = useAccount();
  const analytics = useProductAnalytics(analyticsPage);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [isConnectingMicrosoft, setIsConnectingMicrosoft] = useState(false);

  const setOnboardingReturnCookie = () => {
    if (onboardingReturnPath) {
      document.cookie = `${CALENDAR_ONBOARDING_RETURN_COOKIE}=${encodeURIComponent(onboardingReturnPath)}; path=/; max-age=180; SameSite=Lax; Secure`;
    }
  };

  const handleConnectGoogle = async () => {
    analytics.captureAction("calendar_connect_started", {
      provider: "google",
      has_onboarding_return_path: Boolean(onboardingReturnPath),
    });
    setIsConnectingGoogle(true);
    try {
      const response = await fetchWithAccount({
        url: "/api/google/calendar/auth-url",
        emailAccountId,
        init: { headers: { "Content-Type": "application/json" } },
      });

      if (!response.ok) {
        throw new Error("Failed to initiate Google calendar connection");
      }

      const data: GetCalendarAuthUrlResponse = await response.json();
      setOnboardingReturnCookie();
      redirectToSafeUrl(data.url, { allowExternal: true });
    } catch (error) {
      analytics.captureAction("calendar_connect_start_failed", {
        provider: "google",
      });
      captureException(error, {
        extra: { context: "Google Calendar OAuth initiation" },
      });
      toastError({
        title: "Error initiating Google calendar connection",
        description: "Please try again or contact support",
      });
      setIsConnectingGoogle(false);
    }
  };

  const handleConnectMicrosoft = async () => {
    analytics.captureAction("calendar_connect_started", {
      provider: "microsoft",
      has_onboarding_return_path: Boolean(onboardingReturnPath),
    });
    setIsConnectingMicrosoft(true);
    try {
      const response = await fetchWithAccount({
        url: "/api/outlook/calendar/auth-url",
        emailAccountId,
        init: { headers: { "Content-Type": "application/json" } },
      });

      if (!response.ok) {
        throw new Error("Failed to initiate Microsoft calendar connection");
      }

      const data: GetCalendarAuthUrlResponse = await response.json();
      setOnboardingReturnCookie();
      redirectToSafeUrl(data.url, { allowExternal: true });
    } catch (error) {
      analytics.captureAction("calendar_connect_start_failed", {
        provider: "microsoft",
      });
      captureException(error, {
        extra: { context: "Microsoft Calendar OAuth initiation" },
      });
      toastError({
        title: "Error initiating Microsoft calendar connection",
        description: "Please try again or contact support",
      });
      setIsConnectingMicrosoft(false);
    }
  };

  return (
    <div className="flex gap-2 flex-wrap md:flex-nowrap">
      {provider !== "microsoft" ? (
        <Button
          onClick={handleConnectGoogle}
          disabled={isConnectingGoogle || isConnectingMicrosoft}
          variant="outline"
          className="flex w-full items-center gap-2 md:w-auto"
        >
          <Image
            src="/images/google.svg"
            alt="Google"
            width={16}
            height={16}
            unoptimized
          />
          {isConnectingGoogle
            ? "Connecting..."
            : reconnect
              ? "Reconnect Google Calendar"
              : "Add Google Calendar"}
        </Button>
      ) : null}

      {provider !== "google" ? (
        <Button
          onClick={handleConnectMicrosoft}
          disabled={isConnectingGoogle || isConnectingMicrosoft}
          variant="outline"
          className="flex w-full items-center gap-2 md:w-auto"
        >
          <Image
            src="/images/microsoft.svg"
            alt="Microsoft"
            width={16}
            height={16}
            unoptimized
          />
          {isConnectingMicrosoft
            ? "Connecting..."
            : reconnect
              ? "Reconnect Outlook Calendar"
              : "Add Outlook Calendar"}
        </Button>
      ) : null}
    </div>
  );
}
