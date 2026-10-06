/* eslint-disable no-process-env */
import * as Sentry from "@sentry/nextjs";
import { beforeSend, beforeSendTransaction } from "@/utils/sentry-scrub";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Imported here so the database client never enters the edge bundle.
    const { startBackgroundJobWorker } = await import(
      "@/utils/background-jobs/worker"
    );
    startBackgroundJobWorker();

    // Bots built from in-app configs must be ready before the first webhook or
    // notification send; failures are logged and retried lazily per request.
    const { ensureMessagingAdaptersHydrated } = await import(
      "@/utils/messaging/chat-sdk/adapter-hydration"
    );
    ensureMessagingAdaptersHydrated();

    // this is your Sentry.init call from `sentry.server.config.js|ts`
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      // Adjust this value in production, or use tracesSampler for greater control
      tracesSampleRate: 0.1,
      // Setting this option to true will print useful information to the console while you're setting up Sentry.
      debug: false,
      // Redact PII/secrets before sending to Sentry (third party).
      beforeSend,
      beforeSendTransaction,
      // uncomment the line below to enable Spotlight (https://spotlightjs.com)
      // spotlight: process.env.NODE_ENV === 'development',
    });
  }

  // This is your Sentry.init call from `sentry.edge.config.js|ts`
  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      // Adjust this value in production, or use tracesSampler for greater control
      tracesSampleRate: 0.1,
      // Setting this option to true will print useful information to the console while you're setting up Sentry.
      debug: false,
      // Redact PII/secrets before sending to Sentry (third party).
      beforeSend,
      beforeSendTransaction,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
