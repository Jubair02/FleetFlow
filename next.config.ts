import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const isDev = process.env.NODE_ENV === "development";

// No nonces: they would force every page to render dynamically. Inline scripts
// stay allowed (Next's bootstrap); everything else is same-origin. Proof photos
// are proxied through /api/pod, so images never load from a third party.
// connect-src allows Sentry's ingest hosts for client error reports.
// Map tiles, styles, glyphs and sprites (MapLibre fetches them, then decodes
// in a blob: worker): Barikoi, or OpenStreetMap's raster tiles without a key
// (docs/MAPS.md).
const MAP_HOSTS = "https://*.barikoi.com https://barikoi.xyz https://*.barikoi.xyz https://tile.openstreetmap.org";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' blob: data: ${MAP_HOSTS}`,
  "font-src 'self'",
  `connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io ${MAP_HOSTS}${isDev ? " ws:" : ""}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Geolocation is used for proof-of-delivery location; the camera only through file inputs.
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Origin only, never the path: tracking/reset tokens in URLs don't leak, while
  // map tile servers (OSM requires a referrer) and Barikoi's domain-restricted
  // browser key still see which site is asking.
  { key: "Referrer-Policy", value: "strict-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // No map here, and the URL carries a one-time secret: send nothing at all.
      { source: "/reset-password", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

// Source maps are uploaded to Sentry only when SENTRY_AUTH_TOKEN is set (CI / Vercel);
// local builds skip the upload.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG ?? "jubu",
  project: process.env.SENTRY_PROJECT ?? "fleetflow",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN, deleteSourcemapsAfterUpload: true },
  telemetry: false,
});
