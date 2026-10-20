"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
    throw new ApiRequestError(res.status, message);
  }
  return data as T;
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
 *  - the global refreshKey bumps (after any mutation elsewhere), or
 *  - deps change.
 */
export function useApiData<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const [error, setError] = useState<string | null>(null);
  const refreshKey = useAppStore((s) => s.refreshKey);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!url) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<T>(url);
      if (mounted.current) setData(result);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (mounted.current) setLoading(false);
    }
     
  }, [url, ...deps]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return { data, loading, error, reload: load };
}
