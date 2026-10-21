"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body && !isForm ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
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

/**
 * Fetch data from an API endpoint. Automatically refetches when:
 *  - the URL changes, or
 *  - the global refreshKey bumps (after any mutation elsewhere).
 * Responses that arrive after a newer request was issued are discarded.
 */
export function useApiData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const [error, setError] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const refreshKey = useAppStore((s) => s.refreshKey);
  const requestId = useRef(0);

  useEffect(() => {
    return () => {
      requestId.current++; // drop in-flight responses after unmount
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
      const result = await apiFetch<T>(url);
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
  }, [load, refreshKey]);

  // Until the current URL has answered, report loading (avoids a one-frame "empty" state).
  const pending = !!url && loadedUrl !== url;
  return { data, loading: loading || pending, error: pending ? null : error, reload: load };
}
