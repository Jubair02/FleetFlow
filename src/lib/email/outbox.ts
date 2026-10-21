import type { PrismaClient } from "@prisma/client";
import type { EmailProvider } from "@/lib/email/provider";
import { renderHtml, senderName } from "@/lib/email/templates";

// ─────────────────────────────────────────────────────────────
// Email outbox: Notification rows with channel=EMAIL are the queue.
//
//   PENDING ──claim──▶ SENDING ──ok──▶ SENT (or SIMULATED in console mode)
//      ▲                  │
//      └──── retry ◀── FAILED (lastError)   max MAX_ATTEMPTS claims per row
//
// A claim is a conditional updateMany, so two workers can't both send
// the same row. While SENDING, `sentAt` holds the claim time (it is
// overwritten on success and cleared on failure); that is how stuck
// SENDING rows are detected. The provider idempotency key is fixed per
// row, so a re-send after a crash mid-request is dropped by the provider.
// ─────────────────────────────────────────────────────────────

export const EMAIL_STATUSES = ["PENDING", "SENDING", "SENT", "FAILED", "SIMULATED"] as const;
export type EmailRowStatus = (typeof EMAIL_STATUSES)[number];

export const MAX_ATTEMPTS = 3;
export const STALE_PENDING_MS = 2 * 60_000;
export const STALE_SENDING_MS = 5 * 60_000;
const MAX_ERROR_LENGTH = 300;
export const RETRY_BATCH_LIMIT = 50;

export interface NewEmail {
  organizationId: string;
  userId?: string | null;
  deliveryId?: string | null;
  type: string;
  recipientEmail: string;
  subject: string;
  text: string;
  /** event-specific key; a second insert with the same key is skipped */
  dedupeKey?: string | null;
}

export interface OutboxEmail {
  id: string;
  recipientEmail: string | null;
  subject: string;
  text: string;
  companyName: string | null;
}

/** "fresh": right after insert (PENDING only). "retry": FAILED, stale PENDING, stuck SENDING. */
export type ClaimMode = "fresh" | "retry";

export interface OutboxStore {
  /** Insert a PENDING row; returns null when the dedupeKey already exists. */
  insert(email: NewEmail): Promise<{ id: string } | null>;
  /** Atomically move a claimable row to SENDING (attempts+1). false = not claimable. */
  claim(id: string, mode: ClaimMode, now: Date): Promise<boolean>;
  get(id: string): Promise<OutboxEmail | null>;
  markSent(id: string, providerMessageId: string, now: Date): Promise<void>;
  markSimulated(id: string, providerMessageId: string, now: Date): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  /** Ids of this org's retryable rows (optionally limited to `ids`). */
  findRetryable(organizationId: string, now: Date, ids?: string[]): Promise<string[]>;
}

export type DispatchResult = "SENT" | "SIMULATED" | "FAILED" | "SKIPPED";

/** Short, single-line error for storage/display. Never includes credentials. */
export function shortError(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error";
  return (
    raw
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/\bre_[A-Za-z0-9_]{8,}/g, "[redacted]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_ERROR_LENGTH) || "Unknown error"
  );
}

/** Pure version of the retry rule (mirrors the store's query). */
export function isRetryable(
  row: { status: string | null; attempts: number; createdAt: Date; sentAt: Date | null },
  now: Date
): boolean {
  if (row.attempts >= MAX_ATTEMPTS) return false;
  const age = (d: Date) => now.getTime() - d.getTime();
  switch (row.status) {
    case "FAILED":
      return true;
    case "PENDING":
      return age(row.createdAt) > STALE_PENDING_MS;
    case "SENDING":
      return age(row.sentAt ?? row.createdAt) > STALE_SENDING_MS;
    default:
      return false;
  }
}

/** Claim → send → record the outcome. Provider errors never escape; store errors do. */
export async function dispatchEmail(
  store: OutboxStore,
  provider: EmailProvider,
  id: string,
  mode: ClaimMode = "fresh",
  now: Date = new Date()
): Promise<DispatchResult> {
  if (!(await store.claim(id, mode, now))) return "SKIPPED";

  const email = await store.get(id);
  if (!email || !email.recipientEmail) {
    await store.markFailed(id, "No recipient email address");
    return "FAILED";
  }

  try {
    const { id: providerId } = await provider.send({
      to: email.recipientEmail,
      subject: email.subject,
      text: email.text,
      html: renderHtml({ subject: email.subject, text: email.text, companyName: email.companyName }),
      idempotencyKey: `fleetflow-notification-${id}`,
      fromName: senderName(email.companyName),
    });
    if (provider.simulated) {
      await store.markSimulated(id, providerId, new Date());
      return "SIMULATED";
    }
    await store.markSent(id, providerId, new Date());
    return "SENT";
  } catch (e) {
    await store.markFailed(id, shortError(e));
    return "FAILED";
  }
}

/** Insert (deduped) and dispatch immediately. `queued: false` means the event was already queued. */
export async function queueAndSend(
  store: OutboxStore,
  provider: EmailProvider,
  email: NewEmail
): Promise<{ queued: false } | { queued: true; id: string; result: DispatchResult }> {
  const row = await store.insert(email);
  if (!row) return { queued: false };
  const result = await dispatchEmail(store, provider, row.id, "fresh");
  return { queued: true, id: row.id, result };
}

export interface RetrySummary {
  attempted: number;
  sent: number;
  simulated: number;
  failed: number;
  skipped: number;
}

/** Re-dispatch an org's retryable rows, one at a time. */
export async function retryEmails(
  store: OutboxStore,
  provider: EmailProvider,
  organizationId: string,
  opts: { ids?: string[]; now?: Date } = {}
): Promise<RetrySummary> {
  const now = opts.now ?? new Date();
  const ids = (await store.findRetryable(organizationId, now, opts.ids)).slice(0, RETRY_BATCH_LIMIT);
  const summary: RetrySummary = { attempted: ids.length, sent: 0, simulated: 0, failed: 0, skipped: 0 };
  if (opts.ids) summary.skipped += opts.ids.length - ids.length; // not found, other org, or out of attempts
  for (const id of ids) {
    const r = await dispatchEmail(store, provider, id, "retry", now);
    if (r === "SENT") summary.sent++;
    else if (r === "SIMULATED") summary.simulated++;
    else if (r === "FAILED") summary.failed++;
    else summary.skipped++;
  }
  return summary;
}

// ── Prisma-backed store ──────────────────────────────────────

type NotificationDb = Pick<PrismaClient, "notification">;

function isDedupeConflict(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } } | null;
  if (err?.code !== "P2002") return false;
  const target = err.meta?.target;
  if (target == null) return true; // dedupeKey is the only unique column a fresh cuid row can hit
  return Array.isArray(target) ? target.some((t) => String(t).includes("dedupeKey")) : String(target).includes("dedupeKey");
}

/** Prisma `where` for rows that a retry may claim. */
export function retryableWhere(now: Date) {
  const pendingCutoff = new Date(now.getTime() - STALE_PENDING_MS);
  const sendingCutoff = new Date(now.getTime() - STALE_SENDING_MS);
  return {
    attempts: { lt: MAX_ATTEMPTS },
    OR: [
      { status: "FAILED" },
      { status: "PENDING", createdAt: { lt: pendingCutoff } },
      { status: "SENDING", sentAt: { lt: sendingCutoff } },
      { status: "SENDING", sentAt: null, createdAt: { lt: sendingCutoff } },
    ],
  };
}

export function createPrismaOutboxStore(prisma: NotificationDb): OutboxStore {
  return {
    async insert(email) {
      try {
        const row = await prisma.notification.create({
          data: {
            organizationId: email.organizationId,
            userId: email.userId ?? null,
            deliveryId: email.deliveryId ?? null,
            type: email.type,
            channel: "EMAIL",
            title: email.subject,
            body: email.text,
            recipientEmail: email.recipientEmail,
            status: "PENDING",
            dedupeKey: email.dedupeKey ?? null,
          },
          select: { id: true },
        });
        return row;
      } catch (e) {
        if (isDedupeConflict(e)) return null;
        throw e;
      }
    },

    async claim(id, mode, now) {
      const where =
        mode === "fresh"
          ? { id, channel: "EMAIL", status: "PENDING", attempts: { lt: MAX_ATTEMPTS } }
          : { id, channel: "EMAIL", ...retryableWhere(now) };
      const { count } = await prisma.notification.updateMany({
        where,
        data: { status: "SENDING", attempts: { increment: 1 }, sentAt: now },
      });
      return count === 1;
    },

    async get(id) {
      const row = await prisma.notification.findUnique({
        where: { id },
        select: { id: true, recipientEmail: true, title: true, body: true, organization: { select: { name: true } } },
      });
      if (!row) return null;
      return {
        id: row.id,
        recipientEmail: row.recipientEmail,
        subject: row.title,
        text: row.body,
        companyName: row.organization?.name ?? null,
      };
    },

    async markSent(id, providerMessageId, now) {
      await prisma.notification.updateMany({
        where: { id, status: "SENDING" },
        data: { status: "SENT", sentAt: now, providerMessageId, lastError: null },
      });
    },

    async markSimulated(id, providerMessageId, now) {
      await prisma.notification.updateMany({
        where: { id, status: "SENDING" },
        data: { status: "SIMULATED", sentAt: now, providerMessageId, lastError: null },
      });
    },

    async markFailed(id, error) {
      await prisma.notification.updateMany({
        where: { id, status: "SENDING" },
        data: { status: "FAILED", sentAt: null, lastError: error.slice(0, MAX_ERROR_LENGTH) },
      });
    },

    async findRetryable(organizationId, now, ids) {
      const rows = await prisma.notification.findMany({
        where: {
          organizationId,
          channel: "EMAIL",
          ...(ids ? { id: { in: ids } } : {}),
          ...retryableWhere(now),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: RETRY_BATCH_LIMIT,
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },
  };
}
