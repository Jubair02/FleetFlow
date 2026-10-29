import type { init } from "@sentry/nextjs";

type DataCollection = NonNullable<Parameters<typeof init>[0]["dataCollection"]>;

/**
 * What Sentry may collect — shared by the server and browser SDKs.
 * Deliveries carry recipient names, phones and addresses, tracking tokens
 * travel in query strings, and handlers hold passwords in local variables,
 * so everything beyond the error and its stack is off.
 */
export const SENTRY_DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: { allow: ["user-agent", "content-type", "content-length", "referer"] },
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  stackFrameVariables: false,
};

export const SENTRY_TRACES_SAMPLE_RATE = 0.1;
