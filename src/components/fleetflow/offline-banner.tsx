"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Shown while the browser reports no connection (drivers often lose signal mid-route). */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="status" className="mb-4 flex items-center gap-2.5 rounded-xl border border-zinc-300 bg-zinc-100 px-4 py-2.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      <span>You&apos;re offline. You can keep reading, but changes can&apos;t be saved until your connection is back.</span>
    </div>
  );
}
