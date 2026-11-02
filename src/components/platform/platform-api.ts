"use client";

import { useEffect, useState } from "react";
import { useCachedData } from "@/lib/api-client";
import { revalidateData, type CacheKeyMatcher } from "@/lib/data-cache";

// ─────────────────────────────────────────────────────────────
// Platform console API client — deliberately separate from
// src/lib/api-client.ts, which signs the COMPANY session out on a 401.
// Here a 401 only notifies the console so it can return to its own
// sign-in screen; the company store is never touched.
// ─────────────────────────────────────────────────────────────

export class PlatformRequestError extends Error {
  status: number;
  /** Parsed JSON body of the error response (e.g. a 409 `{ error, impact }`). */
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

type Listener = () => void;

const unauthorizedListeners = new Set<Listener>();

/** Subscribe to "platform session ended" (any 401 outside the login call). */
export function onPlatformUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export async function platformFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new PlatformRequestError(0, "Network error — check your connection and try again.");
  }
  let data: unknown = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const message = (data as { error?: string })?.error || `Request failed (${res.status})`;
    if (res.status === 401 && path !== "/api/platform/auth/login") {
      unauthorizedListeners.forEach((l) => l());
    }
    throw new PlatformRequestError(res.status, message, data);
  }
  return data as T;
}

export const platformApi = {
  get: <T>(path: string) => platformFetch<T>(path),
  post: <T>(path: string, body?: unknown) => platformFetch<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) => platformFetch<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string, body?: unknown) => platformFetch<T>(path, { method: "DELETE", body: JSON.stringify(body ?? {}) }),
};

// ── Cached data (shared hook with the company app) ───────────

/** Refetch platform data after a mutation (every /api/platform/* request, or the matching ones). */
export function bumpPlatformData(match: CacheKeyMatcher = "/api/platform") {
  void revalidateData(match);
}

/** Build "/path?a=1&b=2", skipping empty values. */
export function withQuery(path: string, params: Record<string, string | number | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

const fetchPlatform = <T,>(url: string) => platformFetch<T>(url);

/**
 * Fetch platform data — the company app's cached hook (src/lib/api-client.ts)
 * with this file's fetcher, so a 401 returns to sign-in without touching the
 * company store. Refetches when the URL changes or after bumpPlatformData().
 */
export function usePlatformData<T>(url: string | null) {
  return useCachedData<T>(url, fetchPlatform<T>);
}

/** Value that only updates after `delay` ms without changes (search inputs). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function errorMessage(e: unknown, fallback = "Something went wrong"): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
