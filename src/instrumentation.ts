import * as Sentry from "@sentry/nextjs";
import { SENTRY_DATA_COLLECTION, SENTRY_TRACES_SAMPLE_RATE } from "@/lib/sentry-options";
import { hasPublicAppUrl } from "@/lib/email/templates";

// Server-side error monitoring. Sentry stays off until SENTRY_DSN (or
// NEXT_PUBLIC_SENTRY_DSN) is set, so development and tests send nothing.
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" && process.env.NEXT_RUNTIME !== "edge") return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    dataCollection: SENTRY_DATA_COLLECTION,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  });

  // Fail fast rather than email customers tracking links to localhost.
  if (process.env.NODE_ENV === "production" && !hasPublicAppUrl()) {
    throw new Error("APP_URL must be set in production (the public URL used in emailed links)");
  }
}

// Errors thrown from server components, route handlers and the proxy.
export const onRequestError = Sentry.captureRequestError;
