import { mutate, unload } from "swr";

// ─────────────────────────────────────────────────────────────
// Request cache controls shared by the company app and the platform
// console. Cache keys are the request URLs used with useApiData /
// usePlatformData (e.g. "/api/deliveries?page=1&pageSize=20").
// ─────────────────────────────────────────────────────────────

/**
 * Which cached requests to refresh:
 *  - a URL prefix, matched on a path boundary: "/api/deliveries" matches
 *    "/api/deliveries", "/api/deliveries?page=2" and "/api/deliveries/abc",
 *    but not "/api/deliveries-export"
 *  - a list of such prefixes
 *  - a predicate over the key
 */
export type CacheKeyMatcher = string | readonly string[] | ((key: string) => boolean);

function matchesPrefix(key: string, prefix: string): boolean {
  if (key === prefix) return true;
  if (!key.startsWith(prefix)) return false;
  // "/api/x/" or "/api/x?" given explicitly: plain prefix match.
  if (prefix.endsWith("/") || prefix.endsWith("?") || prefix.endsWith("&")) return true;
  const next = key[prefix.length];
  return next === "/" || next === "?";
}

/** Does a cache key belong to `match`? No matcher = every key. */
export function matchesCacheKey(key: unknown, match?: CacheKeyMatcher): boolean {
  if (typeof key !== "string") return false;
  if (match === undefined) return true;
  if (typeof match === "function") return match(key);
  if (typeof match === "string") return matchesPrefix(key, match);
  return match.some((p) => matchesPrefix(key, p));
}

/**
 * Refetch every cached request matching `match` (all when omitted).
 * Mounted screens refetch now, bypassing request de-duplication; the rest
 * are marked stale and refetch when they mount again.
 */
export function revalidateData(match?: CacheKeyMatcher): Promise<unknown> {
  return mutate((key) => matchesCacheKey(key, match));
}

/** Forget every cached response and drop in-flight ones (sign-out: nothing may leak to the next user). */
export function clearDataCache(): void {
  unload({ revalidate: false });
}
