"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

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
};

// ── Global refresh signal (bump after any mutation) ──────────

let refreshKey = 0;
const refreshListeners = new Set<Listener>();

export function bumpPlatformData() {
  refreshKey++;
  refreshListeners.forEach((l) => l());
}

function subscribeRefresh(l: Listener) {
  refreshListeners.add(l);
  return () => {
    refreshListeners.delete(l);
  };
}

const getRefreshKey = () => refreshKey;

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

/**
 * Fetch platform data; refetches when the URL changes or after bumpPlatformData().
 * Stale responses (an older URL answering late) are discarded.
 */
export function usePlatformData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const [error, setError] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const key = useSyncExternalStore(subscribeRefresh, getRefreshKey, getRefreshKey);
  const requestId = useRef(0);

  useEffect(() => {
    return () => {
      requestId.current++;
    };
  }, []);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    if (!url) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await platformFetch<T>(url);
      if (id !== requestId.current) return;
      setData(result);
      setError(null);
      setLoadedUrl(url);
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e instanceof Error ? e.message : "Failed to load");
      setLoadedUrl(url);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-change is this hook's purpose
    load();
  }, [load, key]);

  const pending = !!url && loadedUrl !== url;
  return { data, loading: loading || pending, error: pending ? null : error, reload: load };
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
