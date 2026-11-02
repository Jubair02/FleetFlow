import { createHash } from "crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decodeCursor, encodeCursor, readV1Json, V1Error, v1Json, validationError, withApiKey, type Cursor } from "@/lib/api-v1";
import { createDelivery } from "@/lib/delivery-service";
import { DELIVERY_STATUSES } from "@/lib/constants";
import { PUBLIC_DELIVERY_INCLUDE, toPublicDelivery } from "@/lib/public-delivery";
import { createDeliverySchema } from "@/lib/validation";
import { inServiceArea, isValidLatLng, roundCoord } from "@/lib/geo";

// ─────────────────────────────────────────────────────────────
// /api/v1/deliveries — public API (docs/API.md), API-key auth.
//
// POST creates a delivery exactly like the app does (src/lib/delivery-service.ts).
// A retried create never duplicates — the existing delivery comes back with
// 200 (instead of 201) and `Idempotent-Replayed: true` when either
//   • the Idempotency-Key header was already used by this company in the
//     last 24 h (same body; a different body is a 409), or
//   • externalRef matches a delivery of this company that isn't cancelled.
// Both checks run again inside the create transaction while the company
// row is locked, so concurrent retries can't both create.
//
// GET lists deliveries with cursor pagination. Default order: newest
// first. With updatedSince: oldest change first (for incremental sync).
// ─────────────────────────────────────────────────────────────

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const IDEMPOTENCY_WINDOW_MS = 24 * 3_600_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type Db = Prisma.TransactionClient | typeof db;

/** Create body: the app's fields plus an optional map point (stored with geoSource API). */
const v1CreateSchema = createDeliverySchema.extend({
  location: z
    .object({ lat: z.number("location.lat must be a number"), lng: z.number("location.lng must be a number") })
    .refine((p) => isValidLatLng(p.lat, p.lng) && inServiceArea(p), "location must be a { lat, lng } point inside Bangladesh")
    .nullable()
    .optional(),
});

interface PriorCreate {
  deliveryId: string;
  requestHash: string | null;
}

function parseDetail(detail: string | null): { idempotencyKey?: unknown; requestHash?: unknown } {
  try {
    return JSON.parse(detail ?? "{}") as { idempotencyKey?: unknown; requestHash?: unknown };
  } catch {
    return {};
  }
}

/** The delivery created earlier with this Idempotency-Key (audit trail lookup), if it still exists. */
async function findByIdempotencyKey(client: Db, organizationId: string, key: string): Promise<PriorCreate | null> {
  const logs = await client.auditLog.findMany({
    where: {
      organizationId,
      action: "DELIVERY_CREATED",
      entityType: "Delivery",
      createdAt: { gte: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS) },
      detail: { contains: `"idempotencyKey":${JSON.stringify(key)}` },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { entityId: true, detail: true },
  });
  // LIKE treats "_" as a wildcard, so confirm the exact key
  const match = logs.map((l) => ({ id: l.entityId, detail: parseDetail(l.detail) })).find((l) => l.detail.idempotencyKey === key);
  if (!match) return null;
  const exists = await client.delivery.findFirst({ where: { id: match.id, organizationId }, select: { id: true } });
  if (!exists) return null; // deleted since — a new create is fine
  return { deliveryId: match.id, requestHash: typeof match.detail.requestHash === "string" ? match.detail.requestHash : null };
}

async function findByExternalRef(client: Db, organizationId: string, externalRef: string): Promise<string | null> {
  const row = await client.delivery.findFirst({
    where: { organizationId, externalRef, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return row?.id ?? null;
}

function reusedKeyError(): V1Error {
  return new V1Error(409, "idempotency_key_reused", "This Idempotency-Key was already used with a different request body");
}

async function publicDelivery(id: string) {
  const d = await db.delivery.findUniqueOrThrow({ where: { id }, include: PUBLIC_DELIVERY_INCLUDE });
  return toPublicDelivery(d);
}

export async function POST(req: Request) {
  return withApiKey(req, async (principal) => {
    const idempotencyKey = req.headers.get("idempotency-key")?.trim() || null;
    if (idempotencyKey && !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
      throw new V1Error(400, "invalid_idempotency_key", "Idempotency-Key must be 1–128 characters of letters, digits, _ . : or -");
    }
    const parsed = v1CreateSchema.safeParse(await readV1Json(req));
    if (!parsed.success) throw validationError(parsed.error);
    const data = parsed.data;
    const externalRef = data.externalRef || null;
    const requestHash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
    const { organizationId } = principal;

    const replay = async (id: string) =>
      v1Json({ delivery: await publicDelivery(id) }, 200, principal, { "Idempotent-Replayed": "true" });

    // fast path: no lock needed to answer a plain retry
    if (idempotencyKey) {
      const prior = await findByIdempotencyKey(db, organizationId, idempotencyKey);
      if (prior) {
        if (prior.requestHash && prior.requestHash !== requestHash) throw reusedKeyError();
        return replay(prior.deliveryId);
      }
    }
    if (externalRef) {
      const existing = await findByExternalRef(db, organizationId, externalRef);
      if (existing) return replay(existing);
    }

    const result = await createDelivery({ organizationId, actorId: null, actorName: principal.actorName }, data, {
      findExisting: async (tx) => {
        if (idempotencyKey) {
          const prior = await findByIdempotencyKey(tx, organizationId, idempotencyKey);
          if (prior) {
            if (prior.requestHash && prior.requestHash !== requestHash) throw reusedKeyError();
            return prior.deliveryId;
          }
        }
        return externalRef ? findByExternalRef(tx, organizationId, externalRef) : null;
      },
      auditDetail: {
        via: "api",
        apiKeyId: principal.keyId,
        ...(idempotencyKey ? { idempotencyKey, requestHash } : {}),
      },
      point: data.location ? { lat: roundCoord(data.location.lat), lng: roundCoord(data.location.lng), source: "API" } : null,
    });
    if (!result.created) return replay(result.delivery.id);
    return v1Json({ delivery: await publicDelivery(result.delivery.id) }, 201, principal);
  });
}

// ── list ─────────────────────────────────────────────────────

const listQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) : []))
    .pipe(z.array(z.enum(DELIVERY_STATUSES, "status must be a comma-separated list of delivery statuses")).max(10)),
  externalRef: z.string().trim().max(64).optional(),
  updatedSince: z.string().datetime({ offset: true, message: "updatedSince must be an ISO 8601 date-time" }).optional(),
  limit: z.coerce.number({ message: "limit must be a number" }).int().min(1).max(MAX_LIMIT, `limit must be at most ${MAX_LIMIT}`).default(DEFAULT_LIMIT),
  cursor: z.string().max(300).optional(),
});

export async function GET(req: Request) {
  return withApiKey(req, async (principal) => {
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const parsed = listQuerySchema.safeParse(params);
    if (!parsed.success) throw validationError(parsed.error);
    const q = parsed.data;
    const mode: Cursor["m"] = q.updatedSince ? "u" : "c";

    const and: Prisma.DeliveryWhereInput[] = [{ organizationId: principal.organizationId }];
    if (q.status.length) and.push({ status: { in: q.status } });
    if (q.externalRef) and.push({ externalRef: q.externalRef });
    if (q.updatedSince) and.push({ updatedAt: { gte: new Date(q.updatedSince) } });
    if (q.cursor) {
      const c = decodeCursor(q.cursor, mode);
      const v = new Date(c.v);
      and.push(
        mode === "u"
          ? { OR: [{ updatedAt: { gt: v } }, { updatedAt: v, id: { gt: c.id } }] }
          : { OR: [{ createdAt: { lt: v } }, { createdAt: v, id: { lt: c.id } }] }
      );
    }

    const rows = await db.delivery.findMany({
      where: { AND: and },
      orderBy: mode === "u" ? [{ updatedAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      include: PUBLIC_DELIVERY_INCLUDE,
    });
    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ m: mode, v: (mode === "u" ? last.updatedAt : last.createdAt).toISOString(), id: last.id }) : null;

    return v1Json({ data: page.map(toPublicDelivery), hasMore, nextCursor }, 200, principal);
  });
}
