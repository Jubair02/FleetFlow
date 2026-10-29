"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Last-resort boundary for errors in the root layout. Reports to Sentry and
// offers a reload; styles from the root layout aren't available here.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: "#555", marginBottom: 16 }}>The error has been reported. Reload the page to try again.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: "8px 16px", borderRadius: 8 }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
