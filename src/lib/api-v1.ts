import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { ApiError } from "@/lib/api-helpers";
import type { z } from "zod";
import { db } from "@/lib/db";
import { ApiKeyError, requireApiKey, type ApiPrincipal } from "@/lib/api-keys";

// ─────────────────────────────────────────────────────────────
// Public REST API v1 plumbing (docs/API.md). Every error is
//   { "error": { "code": "<machine code>", "message": "<human text>" } }
// so integrations can branch on `code`. Responses carry X-RateLimit-*
// headers; 429 carries Retry-After. No CORS headers: server-to-server only
// (and src/proxy.ts refuses cross-site browser writes anyway).
// ─────────────────────────────────────────────────────────────

const CODE_BY_STATUS: Record<number, string> = {
  400: "invalid_request",
  401: "unauthorized",
  402: "subscription_inactive",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "invalid_request",
  429: "rate_limited",
  500: "internal_error",
  503: "unavailable",
};

/** An ApiError with an explicit public error code. */
export class V1Error extends ApiError {
  code: string;
  /** The request field at fault (validation errors). */
  field?: string;
  constructor(status: number, code: string, message: string, field?: string) {
    super(status, message);
    this.code = code;
    this.field = field;
  }
}

const PRISMA_ERRORS: Record<string, [number, string, string]> = {
  P2002: [409, "conflict", "A record with this value already exists"],
  P2025: [404, "not_found", "Record not found"],
  P2034: [409, "conflict", "The record was changed concurrently — please retry"],
};

function rateHeaders(principal: ApiPrincipal | null): Record<string, string> {
  if (!principal) return {};
  const { limit, remaining, resetAt } = principal.rateLimit;
  return {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(Math.ceil(resetAt.getTime() / 1000)),
  };
}

export function v1Error(status: number, code: string, message: string, headers: Record<string, string> = {}, field?: string) {
  return NextResponse.json(
    { error: { code, message, ...(field ? { field } : {}) } },
    { status, headers: { "Cache-Control": "no-store", ...headers } }
  );
}

export function v1Fail(e: unknown, principal: ApiPrincipal | null = null) {
  const headers = rateHeaders(principal);
  if (e instanceof ApiError) {
    const code = e instanceof ApiKeyError || e instanceof V1Error ? e.code : CODE_BY_STATUS[e.status] ?? "error";
    if (e instanceof ApiKeyError && e.retryAfter) headers["Retry-After"] = String(e.retryAfter);
    // 403s from plan limits ("Your Growth plan allows …") get a specific code
    const finalCode = code === "forbidden" && /plan allows/i.test(e.message) ? "plan_limit_reached" : code;
    return v1Error(e.status, finalCode, e.message, headers, e instanceof V1Error ? e.field : undefined);
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = PRISMA_ERRORS[e.code];
    if (mapped) return v1Error(mapped[0], mapped[1], mapped[2], headers);
  }
  if (e instanceof Prisma.PrismaClientValidationError) return v1Error(400, "invalid_request", "Invalid input", headers);
  Sentry.captureException(e);
  console.error("[api v1] unexpected error:", e);
  return v1Error(500, "internal_error", "Internal server error", headers);
}

export function v1Json(data: unknown, status: number, principal: ApiPrincipal, extra: Record<string, string> = {}) {
  return NextResponse.json(data as object, { status, headers: { "Cache-Control": "no-store", ...rateHeaders(principal), ...extra } });
}

/** Authenticate with the API key, run the handler, map every error to the v1 shape. */
export async function withApiKey(req: Request, handler: (principal: ApiPrincipal) => Promise<Response>): Promise<Response> {
  let principal: ApiPrincipal | null = null;
  try {
    principal = await requireApiKey(req);
    return await handler(principal);
  } catch (e) {
    return v1Fail(e, principal);
  }
}

/** JSON body for v1 (415 without application/json, 400 when malformed). */
export async function readV1Json(req: Request): Promise<unknown> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new V1Error(415, "unsupported_media_type", "Send the body as JSON with Content-Type: application/json");
  }
  try {
    return await req.json();
  } catch {
    throw new V1Error(400, "invalid_json", "The request body is not valid JSON");
  }
}

/** 400 for the first zod issue, naming the field. */
export function validationError(error: z.ZodError): V1Error {
  const issue = error.issues[0];
  const field = issue?.path.map(String).join(".") || undefined;
  return new V1Error(400, "invalid_request", issue?.message ?? "Invalid input", field);
}

/** The organization's delivery by id or tracking code (e.g. FF-261029-K7QX) — 404 otherwise. */
export async function findDeliveryId(organizationId: string, idOrCode: string): Promise<string> {
  const ref = idOrCode.trim().slice(0, 64);
  const row = ref
    ? await db.delivery.findFirst({
        where: { organizationId, OR: [{ id: ref }, { trackingCode: ref.toUpperCase() }] },
        select: { id: true },
      })
    : null;
  if (!row) throw new V1Error(404, "not_found", "Delivery not found");
  return row.id;
}

/** Opaque cursor: sort mode ("c" = createdAt desc, "u" = updatedAt asc), the last row's sort value and id. */
export interface Cursor {
  m: "c" | "u";
  v: string;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeCursor(raw: string, mode: Cursor["m"]): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    if (c && c.m === mode && typeof c.id === "string" && typeof c.v === "string" && !Number.isNaN(Date.parse(c.v))) return c;
  } catch {
    /* fall through */
  }
  throw new V1Error(400, "invalid_cursor", "Invalid cursor — pass nextCursor from the previous page with the same filters");
}
