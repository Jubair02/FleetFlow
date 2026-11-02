import type { PrismaClient } from "@prisma/client";
import type { EmailProvider } from "@/lib/email/provider";
import { renderHtml, senderName } from "@/lib/email/templates";

// ─────────────────────────────────────────────────────────────
// Outbox: Notification rows with channel=EMAIL (and channel=SMS, see
// src/lib/sms/outbox.ts) are the queue. Both channels share this state
// machine, the claim/finalize queries and the retry rules below.
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
// `lastAttemptAt` records every claim; automatic retries (cron) back off
// from it exponentially.
// ─────────────────────────────────────────────────────────────

export const EMAIL_STATUSES = ["PENDING", "SENDING", "SENT", "FAILED", "SIMULATED"] as const;
export type EmailRowStatus = (typeof EMAIL_STATUSES)[number];

export const MAX_ATTEMPTS = 3;
export const STALE_PENDING_MS = 2 * 60_000;
export const STALE_SENDING_MS = 5 * 60_000;
const MAX_ERROR_LENGTH = 300;
export const RETRY_BATCH_LIMIT = 50;

export type OutboxChannel = "EMAIL" | "SMS";
export const OUTBOX_CHANNELS: readonly OutboxChannel[] = ["EMAIL", "SMS"];

// Automatic retries (GET /api/cron/outbox): FAILED rows wait
// 5 min × 2^(attempts-1), capped at 6 h, and are given up after 3 days.
export const AUTO_RETRY_BASE_MS = 5 * 60_000;
export const AUTO_RETRY_MAX_BACKOFF_MS = 6 * 60 * 60_000;
export const AUTO_RETRY_MAX_AGE_MS = 3 * 24 * 60 * 60_000;
export const AUTO_RETRY_CONCURRENCY = 4;

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

/** Channel-independent part of a store: the state transitions. */
export interface OutboxRowOps {
  /** Atomically move a claimable row to SENDING (attempts+1, lastAttemptAt=now). false = not claimable. */
  claim(id: string, mode: ClaimMode, now: Date): Promise<boolean>;
  markSent(id: string, providerMessageId: string, now: Date): Promise<void>;
  markSimulated(id: string, providerMessageId: string, now: Date): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  /** Ids of this org's retryable rows (optionally limited to `ids`). */
  findRetryable(organizationId: string, now: Date, ids?: string[]): Promise<string[]>;
}

export interface OutboxStore extends OutboxRowOps {
  /** Insert a PENDING row; returns null when the dedupeKey already exists. */
  insert(email: NewEmail): Promise<{ id: string } | null>;
  get(id: string): Promise<OutboxEmail | null>;
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

/** Pure version of the (manual) retry rule (mirrors the store's query). */
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

/** Wait before an automatic retry of a row with `attempts` (5 min, 10 min, 20 min … capped at 6 h). */
export function retryBackoffMs(attempts: number): number {
  const n = Math.max(1, attempts);
  return Math.min(AUTO_RETRY_BASE_MS * 2 ** (n - 1), AUTO_RETRY_MAX_BACKOFF_MS);
}

/** Pure version of the automatic retry rule (mirrors autoRetryWhere). */
export function isDueForAutoRetry(
  row: { status: string | null; attempts: number; createdAt: Date; sentAt: Date | null; lastAttemptAt: Date | null },
  now: Date
): boolean {
  if (now.getTime() - row.createdAt.getTime() > AUTO_RETRY_MAX_AGE_MS) return false;
  if (row.status !== "FAILED") return isRetryable(row, now);
  if (row.attempts >= MAX_ATTEMPTS) return false;
  const last = row.lastAttemptAt ?? row.createdAt; // rows from before lastAttemptAt existed
  return now.getTime() - last.getTime() > retryBackoffMs(row.attempts);
}

/** What a channel needs to turn a claimed row into a provider call. */
export interface DispatchSpec<T> {
  /** true when the provider sends nothing (rows end SIMULATED) */
  simulated: boolean;
  /** Why the row can't be sent (stored as lastError), or null when it can. */
  unsendable(row: T): string | null;
  send(row: T): Promise<{ id: string }>;
}

/** Claim → send → record the outcome, for any channel. Provider errors never escape; store errors do. */
export async function dispatchOutboxRow<T>(
  store: OutboxRowOps & { get(id: string): Promise<T | null> },
  spec: DispatchSpec<T>,
  id: string,
  mode: ClaimMode = "fresh",
  now: Date = new Date()
): Promise<DispatchResult> {
  if (!(await store.claim(id, mode, now))) return "SKIPPED";

  const row = await store.get(id);
  const problem = row ? spec.unsendable(row) : "Notification not found";
  if (!row || problem) {
    await store.markFailed(id, problem ?? "Notification not found");
    return "FAILED";
  }

  try {
    const { id: providerId } = await spec.send(row);
    if (spec.simulated) {
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

/** Claim → send → record the outcome. Provider errors never escape; store errors do. */
export async function dispatchEmail(
  store: OutboxStore,
  provider: EmailProvider,
  id: string,
  mode: ClaimMode = "fresh",
  now: Date = new Date()
): Promise<DispatchResult> {
  return dispatchOutboxRow(
    store,
    {
      simulated: provider.simulated,
      unsendable: (email) => (email.recipientEmail ? null : "No recipient email address"),
      send: (email) =>
        provider.send({
          to: email.recipientEmail!,
          subject: email.subject,
          text: email.text,
          html: renderHtml({ subject: email.subject, text: email.text, companyName: email.companyName }),
          idempotencyKey: `fleetflow-notification-${id}`,
          fromName: senderName(email.companyName),
        }),
    },
    id,
    mode,
    now
  );
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

function emptySummary(): RetrySummary {
  return { attempted: 0, sent: 0, simulated: 0, failed: 0, skipped: 0 };
}

function tally(summary: RetrySummary, r: DispatchResult): void {
  if (r === "SENT") summary.sent++;
  else if (r === "SIMULATED") summary.simulated++;
  else if (r === "FAILED") summary.failed++;
  else summary.skipped++;
}

/** One channel's store + provider, as seen by the manual retry. */
export interface RetryLane {
  findRetryable(organizationId: string, now: Date, ids?: string[]): Promise<string[]>;
  dispatch(id: string, mode: ClaimMode, now: Date): Promise<DispatchResult>;
}

export function emailLane(store: OutboxStore, provider: EmailProvider): RetryLane {
  return {
    findRetryable: (organizationId, now, ids) => store.findRetryable(organizationId, now, ids),
    dispatch: (id, mode, now) => dispatchEmail(store, provider, id, mode, now),
  };
}

/** Re-dispatch an org's retryable rows across channels, one at a time. */
export async function retryOutbox(
  lanes: RetryLane[],
  organizationId: string,
  opts: { ids?: string[]; now?: Date } = {}
): Promise<RetrySummary> {
  const now = opts.now ?? new Date();
  const found = await Promise.all(
    lanes.map(async (lane) => (await lane.findRetryable(organizationId, now, opts.ids)).map((id) => ({ lane, id })))
  );
  const rows = found.flat().slice(0, RETRY_BATCH_LIMIT);
  const summary = emptySummary();
  summary.attempted = rows.length;
  if (opts.ids) summary.skipped += opts.ids.length - rows.length; // not found, other org, or out of attempts
  for (const { lane, id } of rows) tally(summary, await lane.dispatch(id, "retry", now));
  return summary;
}

/** Re-dispatch an org's retryable email rows, one at a time. */
export function retryEmails(
  store: OutboxStore,
  provider: EmailProvider,
  organizationId: string,
  opts: { ids?: string[]; now?: Date } = {}
): Promise<RetrySummary> {
  return retryOutbox([emailLane(store, provider)], organizationId, opts);
}

export interface DueRow {
  id: string;
  channel: string;
}

/**
 * Automatic retry (cron, all organizations): re-dispatch up to `limit` rows
 * that are due (see isDueForAutoRetry), `concurrency` at a time. Rows of a
 * channel without a dispatcher are skipped. Claims stay atomic, so an
 * overlapping manual retry can't double-send.
 */
export async function retryDueOutbox(
  findDue: (now: Date, limit: number) => Promise<DueRow[]>,
  dispatchers: Partial<Record<OutboxChannel, (id: string, now: Date) => Promise<DispatchResult>>>,
  opts: { now?: Date; limit?: number; concurrency?: number } = {}
): Promise<RetrySummary> {
  const now = opts.now ?? new Date();
  const limit = Math.max(1, Math.min(opts.limit ?? RETRY_BATCH_LIMIT, RETRY_BATCH_LIMIT));
  const queue = (await findDue(now, limit)).slice(0, limit);
  const summary = emptySummary();
  summary.attempted = queue.length;

  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const dispatch = dispatchers[row.channel as OutboxChannel];
      tally(summary, dispatch ? await dispatch(row.id, now) : "SKIPPED");
    }
  };
  const workers = Math.max(1, Math.min(opts.concurrency ?? AUTO_RETRY_CONCURRENCY, queue.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return summary;
}

// ── Prisma-backed store ──────────────────────────────────────

type NotificationDb = Pick<PrismaClient, "notification">;

export function isDedupeConflict(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } } | null;
  if (err?.code !== "P2002") return false;
  const target = err.meta?.target;
  if (target == null) return true; // dedupeKey is the only unique column a fresh cuid row can hit
  return Array.isArray(target) ? target.some((t) => String(t).includes("dedupeKey")) : String(target).includes("dedupeKey");
}

/** Prisma clauses for PENDING rows never dispatched and SENDING rows stuck mid-send. */
function staleClauses(now: Date) {
  const pendingCutoff = new Date(now.getTime() - STALE_PENDING_MS);
  const sendingCutoff = new Date(now.getTime() - STALE_SENDING_MS);
  return [
    { status: "PENDING", createdAt: { lt: pendingCutoff } },
    { status: "SENDING", sentAt: { lt: sendingCutoff } },
    { status: "SENDING", sentAt: null, createdAt: { lt: sendingCutoff } },
  ];
}

/** Prisma `where` for rows that a retry may claim. */
export function retryableWhere(now: Date) {
  return {
    attempts: { lt: MAX_ATTEMPTS },
    OR: [{ status: "FAILED" }, ...staleClauses(now)],
  };
}

/** Prisma `where` for rows due for an automatic retry (mirrors isDueForAutoRetry). */
export function autoRetryWhere(now: Date) {
  const failed = Array.from({ length: MAX_ATTEMPTS }, (_, attempts) => {
    const cutoff = new Date(now.getTime() - retryBackoffMs(attempts));
    return [
      { status: "FAILED", attempts, lastAttemptAt: { lt: cutoff } },
      { status: "FAILED", attempts, lastAttemptAt: null, createdAt: { lt: cutoff } },
    ];
  }).flat();
  return {
    attempts: { lt: MAX_ATTEMPTS },
    createdAt: { gte: new Date(now.getTime() - AUTO_RETRY_MAX_AGE_MS) },
    OR: [...failed, ...staleClauses(now)],
  };
}

/** Oldest rows (any outbound channel, every organization) due for an automatic retry. */
export async function findDueRows(prisma: NotificationDb, now: Date, limit: number): Promise<DueRow[]> {
  return prisma.notification.findMany({
    where: { channel: { in: [...OUTBOX_CHANNELS] }, ...autoRetryWhere(now) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, channel: true },
  });
}

/** Claim / finalize / find queries for one channel — shared by the email and SMS stores. */
export function createPrismaRowOps(prisma: NotificationDb, channel: OutboxChannel): OutboxRowOps {
  return {
    async claim(id, mode, now) {
      const where =
        mode === "fresh"
          ? { id, channel, status: "PENDING", attempts: { lt: MAX_ATTEMPTS } }
          : { id, channel, ...retryableWhere(now) };
      const { count } = await prisma.notification.updateMany({
        where,
        data: { status: "SENDING", attempts: { increment: 1 }, sentAt: now, lastAttemptAt: now },
      });
      return count === 1;
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
          channel,
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

export function createPrismaOutboxStore(prisma: NotificationDb): OutboxStore {
  return {
    ...createPrismaRowOps(prisma, "EMAIL"),

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
  };
}
