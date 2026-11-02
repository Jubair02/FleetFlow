"use client";

import type { MouseEvent } from "react";
import { appPath, historyMode, parseAppPath, resolveAppLocation, type AppLocation } from "@/lib/app-routes";
import { currentAppLocation, useAppStore } from "@/store/app-store";

// ─────────────────────────────────────────────────────────────
// Keeps the address bar and the store's navigation state in step.
// The store stays the source of truth for components (setView, goTo*,
// focusDelivery … all keep working); this module mirrors every change
// into history with the native pushState/replaceState API, which Next.js
// integrates with its router without a server round trip, and maps
// Back/Forward (popstate) back into the store.
// ─────────────────────────────────────────────────────────────

/** Marks a history entry we pushed for a detail dialog over its list. */
const OVERLAY_FLAG = "ffOverlay";

function isOverlayEntry(): boolean {
  return !!(window.history.state as Record<string, unknown> | null)?.[OVERLAY_FLAG];
}

function currentHref(): string {
  return window.location.pathname + window.location.search;
}

function locationFromAddress(role: string): AppLocation {
  return resolveAppLocation(parseAppPath(window.location.pathname, window.location.search), role);
}

/** Rewrite the address in place when it isn't the canonical one (e.g. "/" → "/dashboard"). */
function canonicalize(loc: AppLocation) {
  const href = appPath(loc);
  if (href !== currentHref()) window.history.replaceState(null, "", href);
}

/**
 * Load the screen named by the address bar into the store (after boot or
 * sign-in). Unknown or not-allowed addresses open the role's home view.
 */
export function adoptAddress(role: string) {
  const loc = locationFromAddress(role);
  useAppStore.getState().navigate(loc);
  canonicalize(loc);
}

/** Mirror store navigation into history and Back/Forward into the store. Returns the stop function. */
export function startHistorySync(role: string): () => void {
  let applying = false;

  const unsubscribe = useAppStore.subscribe((state, prev) => {
    if (applying || !state.session) return;
    const next = currentAppLocation(state);
    const href = appPath(next);
    if (href === currentHref()) return;
    switch (historyMode(currentAppLocation(prev), next)) {
      case "push":
        window.history.pushState(null, "", href);
        break;
      case "push-overlay":
        window.history.pushState({ [OVERLAY_FLAG]: true }, "", href);
        break;
      case "close-overlay":
        // Opened from its list in this tab: step back so Back doesn't reopen it.
        if (isOverlayEntry()) window.history.back();
        else window.history.replaceState(null, "", href);
        break;
      case "replace":
        // Detail → another detail keeps the entry's overlay mark.
        window.history.replaceState(next.deliveryId && isOverlayEntry() ? { [OVERLAY_FLAG]: true } : null, "", href);
        break;
    }
  });

  const onPopState = () => {
    const loc = locationFromAddress(role);
    applying = true;
    try {
      useAppStore.getState().navigate(loc);
    } finally {
      applying = false;
    }
    canonicalize(loc);
  };
  window.addEventListener("popstate", onPopState);

  return () => {
    unsubscribe();
    window.removeEventListener("popstate", onPopState);
  };
}

/** Plain left click without modifier keys — the only click a client-side link should take over. */
export function isPlainLeftClick(e: MouseEvent): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
