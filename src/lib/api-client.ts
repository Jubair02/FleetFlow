"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { useAppStore } from "@/store/app-store";

// ─────────────────────────────────────────────────────────────
// API client + data hook shared by every view
// ─────────────────────────────────────────────────────────────

export class ApiRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Uploads (proof photos on mobile data) get longer than ordinary requests. */
const TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 90_000;

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body && !isForm ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
      signal: init?.signal ?? AbortSignal.timeout(isForm ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS),
    });
  } catch (e) {
    // Network failures arrive as bare TypeErrors ("Failed to fetch") — say what happened instead.
    // Status 0 = never reached the server, so nothing was saved.
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    throw new ApiRequestError(
      0,
      offline
        ? "You're offline. Check your connection and try again — nothing was saved."
        : timedOut
          ? "The connection is too slow and the request timed out. Try again when you have better signal."
          : "Couldn't reach FleetFlow. Check your connection and try again."
    );
  }
  let data: unknown = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const message = (data as { error?: string })?.error || `Request failed (${res.status})`;
    if (res.status === 401 && !path.startsWith("/api/auth/")) handleSessionExpired();
    throw new ApiRequestError(res.status, message);
  }
  return data as T;
}

/** Session expired or was revoked (e.g. account deactivated) — back to sign-in. */
function handleSessionExpired() {
  const store = useAppStore.getState();
  if (!store.session) return;
  store.signOut();
  toast.error("Your session has ended — please sign in again.");
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

// ── Cached data hook ─────────────────────────────────────────
//
// Built on SWR. Every component asking for the same URL shares one cache
// entry and one request (four components read /api/org). Options, chosen
// to keep the old fetch-on-mount behaviour without request storms:
//  - revalidateOnFocus: off. A dispatcher alt-tabs constantly; refetching
//    every mounted list on each focus would hammer the API. Hooks that need
//    it (notification feed, driver jobs) opt in.
//  - revalidateIfStale: on. Opening a screen shows the cached answer at
//    once and refreshes it in the background (old behaviour: always fetch).
//  - dedupingInterval: 5s. Components mounting together, or a quick
//    there-and-back between screens, share one request. Mutations go through
//    bump(), which bypasses de-duplication.
//  - revalidateOnReconnect: on (refresh after a dropped connection).
//  - shouldRetryOnError: off, like before — a 401/403/404 won't fix itself,
//    and screens show their own Retry.
//  - keepPreviousData: on — while a new URL (filter, page) loads, the
//    previous answer stays on screen, as the old hook did.
//  - compare: by identity, so every answer is a new `data` object as before
//    (screens stamp "updated just now" from data changes).

const DATA_DEFAULTS = {
  revalidateOnFocus: false,
  revalidateIfStale: true,
  revalidateOnReconnect: true,
  dedupingInterval: 5_000,
  shouldRetryOnError: false,
  keepPreviousData: true,
  compare: (a: unknown, b: unknown) => a === b,
} as const;

export interface DataHookOptions {
  /** Poll every N ms while the tab is visible (paused when hidden or offline). */
  refreshInterval?: number;
  /** Also refresh when the tab becomes visible / the window regains focus (throttled). */
  revalidateOnFocus?: boolean;
}

export interface DataHookResult<T> {
  data: T | null;
  /** True until the current URL has answered, and while it refreshes. */
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Shared cached-data hook behind useApiData and the platform console's
 * usePlatformData; `fetcher` decides how errors (e.g. a 401) are handled.
 * The key is the URL itself, so bump("/api/…") can refresh by prefix.
 */
export function useCachedData<T>(url: string | null, fetcher: (url: string) => Promise<T>, options?: DataHookOptions): DataHookResult<T> {
  const { data, error, isValidating, isLoading, mutate } = useSWR<T, unknown, string | null>(url, fetcher, { ...DATA_DEFAULTS, ...options });
  // Wrapped so `onClick={reload}` can't hand the click event to mutate() as new data.
  const reload = useCallback(async () => {
    try {
      await mutate();
    } catch {
      /* the error is reported through `error` */
    }
  }, [mutate]);
  return {
    data: data ?? null,
    loading: !!url && (isLoading || isValidating),
    error: url && error !== undefined ? (error instanceof Error && error.message ? error.message : "Failed to load") : null,
    reload,
  };
}

const fetchApi = <T,>(url: string) => apiFetch<T>(url);

/**
 * Fetch data from an API endpoint (cached; see the notes above). Refetches when:
 *  - the URL changes (the previous answer stays visible meanwhile), or
 *  - bump() runs after a mutation (all data, or the matching URLs).
 * Responses that arrive after a newer request was issued are discarded.
 */
export function useApiData<T>(url: string | null, options?: DataHookOptions): DataHookResult<T> {
  return useCachedData<T>(url, fetchApi<T>, options);
}
