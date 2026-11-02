import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import { hitRateLimit } from "@/lib/api-rate-limit";
import { FEATURES } from "@/lib/plan-catalog";
import type { ApiKeyItem } from "@/lib/developers";

// ─────────────────────────────────────────────────────────────
// Public API keys (docs/API.md). A key is `ff_live_` + 32 random bytes in
// base64url (43 chars, 256 bits). Only its SHA-256 is stored — the full
// key is shown to the admin once, when it is created. `prefix` (the first
// 12 characters) is kept in clear so keys can be told apart in the UI.
// ─────────────────────────────────────────────────────────────

export const API_KEY_PREFIX = "ff_live_";
const KEY_RE = /^ff_live_[A-Za-z0-9_-]{43}$/;
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 4;

/** Requests per key per window; over that → 429 with Retry-After. */
export const API_RATE_LIMIT = 120;
export const API_RATE_WINDOW_MS = 60_000;
/** lastUsedAt is written at most this often per key. */
const LAST_USED_RESOLUTION_MS = 60_000;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateApiKey(): { key: string; prefix: string; keyHash: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, DISPLAY_PREFIX_LENGTH), keyHash: hashApiKey(key) };
}

export function isWellFormedApiKey(key: string): boolean {
  return KEY_RE.test(key);
}

/** The key from `Authorization: Bearer <key>`, or null when absent/malformed. */
export function parseBearerKey(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  if (!m) return null;
  return isWellFormedApiKey(m[1]) ? m[1] : null;
}

/** 401/403/429 refusals of the public API carry a machine-readable code (see src/lib/api-v1.ts). */
export class ApiKeyError extends ApiError {
  code: string;
  retryAfter?: number;
  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(status, message);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export interface ApiPrincipal {
  keyId: string;
  keyName: string;
  organizationId: string;
  /** For audit rows and delivery events, e.g. "API: WooCommerce". */
  actorName: string;
  rateLimit: { limit: number; remaining: number; resetAt: Date };
}

export function apiActorName(keyName: string): string {
  return `API: ${keyName}`.slice(0, 120);
}

/**
 * Authenticate a public API request. Unknown, malformed or revoked key →
 * 401; suspended company → 403; plan without api_access → 403; more than
 * API_RATE_LIMIT requests per minute on this key → 429.
 */
export async function requireApiKey(req: Request, now = new Date()): Promise<ApiPrincipal> {
  const key = parseBearerKey(req.headers.get("authorization"));
  if (!key) throw new ApiKeyError(401, "unauthorized", "Missing or malformed API key — send `Authorization: Bearer ff_live_…`");

  const row = await db.apiKey.findUnique({
    where: { keyHash: hashApiKey(key) },
    select: {
      id: true,
      name: true,
      organizationId: true,
      lastUsedAt: true,
      revokedAt: true,
      organization: { select: { status: true, planRecord: { select: { name: true, features: true } } } },
    },
  });
  if (!row || row.revokedAt) throw new ApiKeyError(401, "unauthorized", "Invalid or revoked API key");
  if (row.organization.status === "SUSPENDED") {
    throw new ApiKeyError(403, "account_suspended", "This FleetFlow account is suspended — contact FleetFlow support");
  }
  const plan = row.organization.planRecord;
  if (!plan.features.includes("api_access")) {
    throw new ApiKeyError(
      403,
      "plan_feature_missing",
      `${FEATURES.api_access.label} isn't included in your ${plan.name} plan. Contact FleetFlow to upgrade.`
    );
  }

  const hit = await hitRateLimit(`api:${row.id}`, API_RATE_LIMIT, API_RATE_WINDOW_MS, now);
  if (!hit.allowed) {
    throw new ApiKeyError(429, "rate_limited", `Rate limit exceeded (${API_RATE_LIMIT} requests per minute per key) — retry in ${hit.retryAfter}s`, hit.retryAfter);
  }

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_RESOLUTION_MS) {
    const cutoff = new Date(now.getTime() - LAST_USED_RESOLUTION_MS);
    // conditional, so concurrent requests write it once; never fails the request
    await db.apiKey
      .updateMany({ where: { id: row.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: cutoff } }] }, data: { lastUsedAt: now } })
      .catch((e) => console.error("[api] lastUsedAt update failed:", e));
  }

  return {
    keyId: row.id,
    keyName: row.name,
    organizationId: row.organizationId,
    actorName: apiActorName(row.name),
    rateLimit: { limit: hit.limit, remaining: hit.remaining, resetAt: hit.resetAt },
  };
}

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdByName: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export function toApiKeyItem(k: ApiKeyRow): ApiKeyItem {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    createdByName: k.createdByName,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
  };
}
