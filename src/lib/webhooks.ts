import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { auditData, bestEffort, notifyInApp } from "@/lib/notify";
import { PUBLIC_DELIVERY_INCLUDE, toPublicDelivery, type PublicDelivery } from "@/lib/public-delivery";
import { PING_EVENT, type WebhookDeliveryItem, type WebhookDeliveryStatus, type WebhookEndpointItem, type WebhookEventType } from "@/lib/developers";
import { postWebhook } from "@/lib/webhook-url";

// ─────────────────────────────────────────────────────────────
// Outgoing webhooks (docs/API.md → Webhooks).
//
//   queue    queueWebhookEvents(tx, …) inserts one WebhookDelivery row
//            (status PENDING) per subscribed active endpoint, INSIDE the
//            transaction of the change — no event without its change,
//            and no change without its event.
//   send     after commit, dispatchWebhooksSoon(orgId) sends the
//            organization's due rows via next/server after(); the daily
//            cron (/api/cron/outbox) sweeps whatever is still due.
//   claim    PENDING (due) or stuck SENDING ──conditional updateMany──▶
//            SENDING (attempts+1, lastAttemptAt=now), so two instances
//            can't both send the same row (same idea as the email outbox).
//   result   2xx → SUCCEEDED. Anything else → PENDING again with
//            nextAttemptAt = now + WEBHOOK_BACKOFF_MS[attempts-1], or
//            FAILED after WEBHOOK_MAX_ATTEMPTS. `ping` is tried once.
//   disable  every failed attempt bumps the endpoint's
//            consecutiveFailures (a success resets it); at
//            AUTO_DISABLE_AFTER the endpoint is disabled and the
//            organization's admins get an in-app notification.
//
// Signature: FleetFlow-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of
// "<t>.<raw body>" keyed with the endpoint secret>.
// ─────────────────────────────────────────────────────────────

/** 8 attempts: first send, then retries after 30 s, 2 min, 10 min, 1 h, 3 h, 6 h, 12 h (≈ 22 h in total). */
export const WEBHOOK_BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 3 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000] as const;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_BACKOFF_MS.length + 1;
export const AUTO_DISABLE_AFTER = 20;
export const WEBHOOK_TIMEOUT_MS = 10_000;
/** A SENDING row older than this was abandoned mid-send (crash/timeout) and may be claimed again. */
export const STALE_SENDING_MS = 2 * 60_000;
const MAX_ERROR_CHARS = 1000;
const RESPONSE_BODY_BYTES = 2048;
/** Finished rows are kept this long for the "recent deliveries" list. */
export const WEBHOOK_RETENTION_DAYS = 30;
const SIGNATURE_TOLERANCE_SEC = 300;
const USER_AGENT = "FleetFlow-Webhooks/1.0";

type Tx = Prisma.TransactionClient;

// ── secrets & signatures ─────────────────────────────────────

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export function signatureHeader(secret: string, body: string, now = new Date()): string {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${signWebhookPayload(secret, t, body)}`;
}

/** Reference verifier (receivers do the same — see docs/API.md). */
export function verifyWebhookSignature(
  secret: string,
  header: string | null | undefined,
  body: string,
  opts: { now?: Date; toleranceSec?: number } = {}
): boolean {
  if (!header) return false;
  const parts = new Map<string, string[]>();
  for (const piece of header.split(",")) {
    const [k, v] = piece.split("=", 2).map((s) => s?.trim());
    if (k && v) parts.set(k, [...(parts.get(k) ?? []), v]);
  }
  const t = Number(parts.get("t")?.[0]);
  if (!Number.isInteger(t)) return false;
  const now = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSec ?? SIGNATURE_TOLERANCE_SEC)) return false;
  const expected = Buffer.from(signWebhookPayload(secret, t, body), "hex");
  return (parts.get("v1") ?? []).some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// ── backoff ──────────────────────────────────────────────────

/** Delay before the next attempt after `attempts` failed attempts, or null to give up. */
export function nextRetryDelay(attempts: number): number | null {
  if (attempts < 1 || attempts >= WEBHOOK_MAX_ATTEMPTS) return null;
  return WEBHOOK_BACKOFF_MS[attempts - 1];
}

export function truncateError(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_ERROR_CHARS ? `${clean.slice(0, MAX_ERROR_CHARS - 1)}…` : clean;
}

// ── queueing (inside the caller's transaction) ───────────────

export type WebhookData = Record<string, unknown>;
export interface QueuedEvent {
  event: WebhookEventType;
  /** The payload's `data`; a function is only called when some endpoint wants the event. */
  data: WebhookData | (() => Promise<WebhookData>);
}

export function newEventId(): string {
  return `evt_${randomBytes(12).toString("hex")}`;
}

export function webhookEnvelope(event: string, data: WebhookData, now = new Date(), id = newEventId()) {
  return { id, type: event, apiVersion: "v1", createdAt: now.toISOString(), data };
}

/**
 * Queue events for every active endpoint of the organization that
 * subscribes to them. Call inside the transaction that makes the change.
 * Costs one indexed query when the organization has no endpoints.
 * Returns the number of rows queued.
 */
export async function queueWebhookEvents(tx: Tx, organizationId: string, items: QueuedEvent[]): Promise<number> {
  if (!items.length) return 0;
  const types = [...new Set(items.map((i) => i.event))];
  const endpoints = await tx.webhookEndpoint.findMany({
    where: { organizationId, active: true, events: { hasSome: types } },
    select: { id: true, events: true },
  });
  if (!endpoints.length) return 0;
  // Endpoints stay configured when a plan loses api_access, but nothing is sent.
  const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { planRecord: { select: { features: true } } } });
  if (!org?.planRecord.features.includes("api_access")) return 0;

  const now = new Date();
  const rows: Prisma.WebhookDeliveryCreateManyInput[] = [];
  for (const item of items) {
    const targets = endpoints.filter((e) => e.events.includes(item.event));
    if (!targets.length) continue;
    const data = typeof item.data === "function" ? await item.data() : item.data;
    const payload = JSON.stringify(webhookEnvelope(item.event, data, now));
    for (const e of targets) {
      rows.push({ endpointId: e.id, organizationId, event: item.event, payload, status: "PENDING", nextAttemptAt: now });
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    await tx.webhookDelivery.createMany({ data: rows.slice(i, i + 500) });
  }
  return rows.length;
}

export function queueWebhookEvent(tx: Tx, organizationId: string, event: WebhookEventType, data: QueuedEvent["data"]): Promise<number> {
  return queueWebhookEvents(tx, organizationId, [{ event, data }]);
}

/** Loads the delivery (as the public API shows it) at most once per transaction step. */
export function deliveryLoader(tx: Tx, deliveryId: string): () => Promise<PublicDelivery> {
  let cached: Promise<PublicDelivery> | null = null;
  return () =>
    (cached ??= tx.delivery
      .findUniqueOrThrow({ where: { id: deliveryId }, include: PUBLIC_DELIVERY_INCLUDE })
      .then(toPublicDelivery));
}

const OUTCOME_EVENTS: Partial<Record<string, WebhookEventType>> = {
  DELIVERED: "delivery.delivered",
  FAILED: "delivery.failed",
  CANCELLED: "delivery.cancelled",
};

/**
 * Events for a status change: always delivery.status_changed, plus the
 * outcome event (delivered / failed / cancelled) and, with `assigned`,
 * delivery.assigned. Call after the delivery row has been updated.
 */
export function queueDeliveryStatusChange(
  tx: Tx,
  organizationId: string,
  deliveryId: string,
  previousStatus: string,
  status: string,
  opts: { assigned?: boolean } = {}
): Promise<number> {
  const load = deliveryLoader(tx, deliveryId);
  const withStatus = async () => ({ delivery: await load(), previousStatus, status });
  const items: QueuedEvent[] = [];
  if (opts.assigned) items.push({ event: "delivery.assigned", data: withStatus });
  items.push({ event: "delivery.status_changed", data: withStatus });
  const outcome = OUTCOME_EVENTS[status];
  if (outcome) items.push({ event: outcome, data: withStatus });
  return queueWebhookEvents(tx, organizationId, items);
}

// ── sending ──────────────────────────────────────────────────

function claimableWhere(now: Date): Prisma.WebhookDeliveryWhereInput {
  return {
    OR: [
      { status: "PENDING", nextAttemptAt: { lte: now } },
      { status: "SENDING", lastAttemptAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } },
    ],
  };
}

export type DeliverOutcome = "SUCCEEDED" | "RETRYING" | "FAILED" | "SKIPPED";

/**
 * Claim one row and POST it. Never throws for delivery problems — they
 * are recorded on the row. "SKIPPED" = not claimable (sent elsewhere,
 * not due yet, or already finished).
 */
export async function deliverWebhook(id: string, now = new Date()): Promise<DeliverOutcome> {
  const claimed = await db.webhookDelivery.updateMany({
    where: { id, ...claimableWhere(now) },
    data: { status: "SENDING", attempts: { increment: 1 }, lastAttemptAt: now },
  });
  if (claimed.count !== 1) return "SKIPPED";

  const row = await db.webhookDelivery.findUnique({
    where: { id },
    include: { endpoint: { select: { id: true, url: true, secret: true, active: true, organizationId: true } } },
  });
  if (!row) return "SKIPPED";
  const finalize = (data: Prisma.WebhookDeliveryUpdateManyMutationInput) =>
    db.webhookDelivery.updateMany({ where: { id, status: "SENDING" }, data });

  if (!row.endpoint.active) {
    await finalize({ status: "FAILED", lastError: "Not sent: the endpoint is disabled" });
    return "FAILED";
  }

  let status: number | null = null;
  let error: string | null = null;
  try {
    const res = await postWebhook({
      url: row.endpoint.url,
      body: row.payload,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "FleetFlow-Event": row.event,
        "FleetFlow-Delivery": row.id,
        "FleetFlow-Signature": signatureHeader(row.endpoint.secret, row.payload, new Date()),
      },
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      maxBodyBytes: RESPONSE_BODY_BYTES,
    });
    status = res.status;
    if (res.status < 200 || res.status >= 300) {
      const redirect = res.status >= 300 && res.status < 400 ? ` (redirects are not followed${res.location ? ` → ${res.location}` : ""})` : "";
      error = `HTTP ${res.status}${redirect}${res.body.trim() ? `: ${res.body}` : ""}`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const isPing = row.event === PING_EVENT;
  if (error === null) {
    await finalize({ status: "SUCCEEDED", responseStatus: status, lastError: null });
    await db.webhookEndpoint.updateMany({ where: { id: row.endpoint.id, consecutiveFailures: { gt: 0 } }, data: { consecutiveFailures: 0 } });
    return "SUCCEEDED";
  }

  const delay = isPing ? null : nextRetryDelay(row.attempts);
  await finalize({
    status: delay === null ? "FAILED" : "PENDING",
    responseStatus: status,
    lastError: truncateError(error),
    ...(delay === null ? {} : { nextAttemptAt: new Date(now.getTime() + delay) }),
  });
  if (!isPing) await bestEffort("webhook failure count", () => recordEndpointFailure(row.endpoint.id, row.endpoint.organizationId, now));
  return delay === null ? "FAILED" : "RETRYING";
}

async function recordEndpointFailure(endpointId: string, organizationId: string, now: Date): Promise<void> {
  const endpoint = await db.webhookEndpoint.update({
    where: { id: endpointId },
    data: { consecutiveFailures: { increment: 1 } },
    select: { consecutiveFailures: true, active: true, url: true },
  });
  if (!endpoint.active || endpoint.consecutiveFailures < AUTO_DISABLE_AFTER) return;
  const reason = `Disabled automatically after ${endpoint.consecutiveFailures} failed deliveries in a row`;
  const disabled = await db.webhookEndpoint.updateMany({
    where: { id: endpointId, active: true },
    data: { active: false, disabledAt: now, disabledReason: reason },
  });
  if (disabled.count !== 1) return; // another instance got there first
  await db.auditLog.create({
    data: auditData({
      organizationId,
      actorName: "FleetFlow",
      action: "WEBHOOK_AUTO_DISABLED",
      entityType: "WebhookEndpoint",
      entityId: endpointId,
      detail: { url: endpoint.url, consecutiveFailures: endpoint.consecutiveFailures },
    }),
  });
  const admins = await db.user.findMany({ where: { organizationId, role: "ADMIN", active: true }, select: { id: true } });
  await Promise.all(
    admins.map((a) =>
      notifyInApp({
        userId: a.id,
        type: "WEBHOOK_DISABLED",
        title: "Webhook endpoint disabled",
        body: `${endpoint.url} failed ${endpoint.consecutiveFailures} times in a row and was disabled. Fix it, then re-enable it in Settings → API & webhooks.`,
      })
    )
  );
}

export interface WebhookDispatchSummary {
  attempted: number;
  succeeded: number;
  retrying: number;
  failed: number;
  skipped: number;
}

/**
 * Send due rows (oldest first), a few at a time, until `limit` rows or
 * the time budget are used up. Scoped to one organization when given.
 */
export async function dispatchDueWebhooks(
  opts: { organizationId?: string; now?: Date; limit?: number; budgetMs?: number; concurrency?: number } = {}
): Promise<WebhookDispatchSummary> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const budget = opts.budgetMs ?? 45_000;
  const due = await db.webhookDelivery.findMany({
    where: { ...(opts.organizationId ? { organizationId: opts.organizationId } : {}), ...claimableWhere(now) },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: opts.limit ?? 50,
    select: { id: true },
  });
  const summary: WebhookDispatchSummary = { attempted: 0, succeeded: 0, retrying: 0, failed: 0, skipped: 0 };
  const queue = due.map((d) => d.id);
  const worker = async () => {
    // budget leaves room for the in-flight sends (WEBHOOK_TIMEOUT_MS each) to finish
    for (let id = queue.shift(); id; id = queue.shift()) {
      if (Date.now() - started > budget) return;
      summary.attempted++;
      let outcome: DeliverOutcome;
      try {
        outcome = await deliverWebhook(id, new Date());
      } catch (e) {
        console.error("[webhooks] delivery failed:", e);
        outcome = "SKIPPED";
      }
      if (outcome === "SUCCEEDED") summary.succeeded++;
      else if (outcome === "RETRYING") summary.retrying++;
      else if (outcome === "FAILED") summary.failed++;
      else summary.skipped++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, queue.length) }, worker));
  return summary;
}

/**
 * After the response is sent, deliver the organization's due webhooks —
 * the rows just queued plus any retries that came due. Call after the
 * transaction that queued events has committed.
 */
export function dispatchWebhooksSoon(organizationId: string): void {
  const work = () =>
    bestEffort("webhook dispatch", () => dispatchDueWebhooks({ organizationId, limit: 25, budgetMs: 20_000 }));
  try {
    after(work);
  } catch {
    // outside a request (scripts/tests): send without blocking the caller
    void work();
  }
}

/** Delete finished rows older than the retention period (cron). */
export async function pruneWebhookDeliveries(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - WEBHOOK_RETENTION_DAYS * 24 * 3_600_000);
  const res = await db.webhookDelivery.deleteMany({ where: { status: { in: ["SUCCEEDED", "FAILED"] }, createdAt: { lt: cutoff } } });
  return res.count;
}

// ── company UI DTOs ──────────────────────────────────────────

type DeliveryRow = {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: Date;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date;
};

export function toWebhookDeliveryItem(d: DeliveryRow): WebhookDeliveryItem {
  return {
    id: d.id,
    event: d.event,
    status: d.status as WebhookDeliveryStatus,
    attempts: d.attempts,
    responseStatus: d.responseStatus,
    lastError: d.lastError,
    createdAt: d.createdAt.toISOString(),
    lastAttemptAt: d.lastAttemptAt ? d.lastAttemptAt.toISOString() : null,
    nextAttemptAt: d.status === "PENDING" ? d.nextAttemptAt.toISOString() : null,
  };
}

type EndpointRow = {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  consecutiveFailures: number;
  disabledAt: Date | null;
  disabledReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  deliveries?: { status: string; responseStatus: number | null; lastAttemptAt: Date | null; createdAt: Date }[];
};

export function toWebhookEndpointItem(e: EndpointRow): WebhookEndpointItem {
  const last = e.deliveries?.[0];
  return {
    id: e.id,
    url: e.url,
    description: e.description,
    events: e.events as WebhookEventType[],
    active: e.active,
    consecutiveFailures: e.consecutiveFailures,
    disabledAt: e.disabledAt ? e.disabledAt.toISOString() : null,
    disabledReason: e.disabledReason,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    lastDelivery: last
      ? { status: last.status as WebhookDeliveryStatus, responseStatus: last.responseStatus, at: (last.lastAttemptAt ?? last.createdAt).toISOString() }
      : null,
  };
}
