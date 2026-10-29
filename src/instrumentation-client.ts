import * as Sentry from "@sentry/nextjs";
import { SENTRY_DATA_COLLECTION, SENTRY_TRACES_SAMPLE_RATE } from "@/lib/sentry-options";

// Browser error monitoring. Off until NEXT_PUBLIC_SENTRY_DSN is set.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  dataCollection: SENTRY_DATA_COLLECTION,
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
