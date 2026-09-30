import "../../styles/globals.css";
import type { Metadata } from "next";
import type React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { Figtree, Fraunces, Inter } from "next/font/google";
import { SideNavWithTopNav } from "@/components/SideNavWithTopNav";
import { auth } from "@/utils/auth";
import { PostHogIdentify } from "@/providers/PostHogProvider";
import { CommandK } from "@/components/CommandK";
import { AppProviders } from "@/providers/AppProviders";
import { AssessUser } from "@/app/(app)/[emailAccountId]/assess";
import { SentryIdentify } from "@/app/(app)/sentry-identify";
import { AiAutomationStatusBanner } from "@/app/(app)/AiAutomationStatusBanner";
import { ErrorMessages } from "@/app/(app)/ErrorMessages";
import { DesktopMailIndicators } from "@/app/(app)/DesktopMailIndicators";
import { ProviderRateLimitBanner } from "@/app/(app)/ProviderRateLimitBanner";
import { MailEngineRuntime } from "@/utils/mail-engine/MailEngineHost";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EmailViewer } from "@/components/EmailViewer";
import { SettingsDialog } from "@/app/(app)/settings/SettingsDialog";
import { AnnouncementDialog } from "@/components/feature-announcements/AnnouncementDialog";
import { captureException } from "@/utils/error";
import prisma from "@/utils/prisma";
import { createScopedLogger } from "@/utils/logger";
import { booleanString } from "@/utils/zod";
import { UiPreferencesProvider } from "@/providers/UiPreferencesProvider";
import {
  getPaletteScript,
  parseUiVariant,
  UI_VARIANT_COOKIE,
} from "@/utils/ui-variant";

const logger = createScopedLogger("AppLayout");

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  preload: true,
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport = {
  themeColor: "#FFF",
  // safe area for iOS PWA
  userScalable: false,
  initialScale: 1,
  maximumScale: 1,
  minimumScale: 1,
  width: "device-width",
  height: "device-height",
  viewportFit: "cover",
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user.email) redirect("/login");

  const cookieStore = await cookies();
  const isClosed = cookieStore.get("left-sidebar:state")?.value === "false";
  const uiVariant = parseUiVariant(cookieStore.get(UI_VARIANT_COOKIE)?.value);
  const bypassPremiumChecks =
    booleanString.parse(process.env.NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS) ?? false;

  after(async () => {
    const email = session.user.email;
    try {
      await prisma.user.update({
        where: { email },
        data: { lastLogin: new Date() },
      });
    } catch (error) {
      logger.error("Failed to update last login", { email, error });
      captureException(error, { userEmail: email });
    }
  });

  return (
    <div
      className={`${inter.variable} ${fraunces.variable} ${figtree.variable}`}
    >
      <script
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static script, no user input
        dangerouslySetInnerHTML={{ __html: getPaletteScript(uiVariant) }}
      />
      <div className={uiVariant === "next" ? "font-body" : "font-inter"}>
        <UiPreferencesProvider variant={uiVariant}>
          <AppProviders>
            <MailEngineRuntime>
              <SideNavWithTopNav
                variant={uiVariant}
                defaultOpen={!isClosed}
                feedbackEnabled={
                  !bypassPremiumChecks ||
                  Boolean(process.env.FEEDBACK_WEBHOOK_URL)
                }
              >
                <DesktopMailIndicators />
                <AiAutomationStatusBanner />
                <ErrorMessages />
                <ProviderRateLimitBanner />
                {children}
              </SideNavWithTopNav>
              <EmailViewer />
              <SettingsDialog />
              <AnnouncementDialog />
              <ErrorBoundary extra={{ component: "AppLayout" }}>
                <PostHogIdentify />

                <CommandK />
                <AssessUser />
                <SentryIdentify email={session.user.email} />
              </ErrorBoundary>
            </MailEngineRuntime>
          </AppProviders>
        </UiPreferencesProvider>
      </div>
    </div>
  );
}
