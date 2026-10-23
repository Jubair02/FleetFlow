"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Remembers the ≥lg collapse choice per shell in localStorage. Storage can be
 * unavailable (private mode, blocked site data) — an in-memory copy keeps the
 * toggle working for the session regardless.
 */
const memory = new Map<string, boolean>();
const listeners = new Set<() => void>();

function read(key: string): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) return raw === "1";
  } catch {
    /* storage blocked — fall back to memory */
  }
  return memory.get(key) ?? false;
}

export function useSidebarCollapsed(storageKey: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      listeners.add(onChange);
      const onStorage = (e: StorageEvent) => {
        if (e.key === storageKey) onChange();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", onStorage);
      };
    },
    [storageKey]
  );

  const collapsed = useSyncExternalStore(
    subscribe,
    () => read(storageKey),
    () => false
  );

  const setCollapsed = useCallback(
    (next: boolean) => {
      memory.set(storageKey, next);
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* storage blocked — memory copy still applies */
      }
      listeners.forEach((l) => l());
    },
    [storageKey]
  );

  return [collapsed, setCollapsed] as const;
}
