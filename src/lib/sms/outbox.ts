import type { PrismaClient } from "@prisma/client";
import {
  createPrismaRowOps,
  dispatchOutboxRow,
  isDedupeConflict,
  type ClaimMode,
  type DispatchResult,
  type OutboxRowOps,
  type RetryLane,
} from "@/lib/email/outbox";
import type { SmsProvider } from "@/lib/sms/provider";

// ─────────────────────────────────────────────────────────────
// SMS outbox: Notification rows with channel=SMS. Same state machine,
// dedupe, attempt limit, atomic claim and retry rules as email
// (src/lib/email/outbox.ts); only the row shape and the provider differ.
// `title` is an outbox label for admins; only `body` is texted.
// ─────────────────────────────────────────────────────────────

export interface NewSms {
  organizationId: string;
  userId?: string | null;
  deliveryId?: string | null;
  type: string;
  /** canonical 8801XXXXXXXXX (normalizeBdPhone) */
  recipientPhone: string;
  /** outbox label, never sent */
  title: string;
  text: string;
  /** event-specific key; a second insert with the same key is skipped */
  dedupeKey?: string | null;
}

export interface OutboxSms {
  id: string;
  recipientPhone: string | null;
  text: string;
}

export interface SmsOutboxStore extends OutboxRowOps {
  /** Insert a PENDING row; returns null when the dedupeKey already exists. */
  insert(sms: NewSms): Promise<{ id: string } | null>;
  get(id: string): Promise<OutboxSms | null>;
}

/** Claim → send → record the outcome. Provider errors never escape; store errors do. */
export function dispatchSms(
  store: SmsOutboxStore,
  provider: SmsProvider,
  id: string,
  mode: ClaimMode = "fresh",
  now: Date = new Date()
): Promise<DispatchResult> {
  return dispatchOutboxRow(
    store,
    {
      simulated: provider.simulated,
      unsendable: (sms) => (sms.recipientPhone ? null : "No recipient phone number"),
      send: (sms) => provider.send({ to: sms.recipientPhone!, text: sms.text, idempotencyKey: `fleetflow-notification-${id}` }),
    },
    id,
    mode,
    now
  );
}

/** Insert (deduped) and dispatch immediately. `queued: false` means the event was already queued. */
export async function queueAndSendSms(
  store: SmsOutboxStore,
  provider: SmsProvider,
  sms: NewSms
): Promise<{ queued: false } | { queued: true; id: string; result: DispatchResult }> {
  const row = await store.insert(sms);
  if (!row) return { queued: false };
  const result = await dispatchSms(store, provider, row.id, "fresh");
  return { queued: true, id: row.id, result };
}

export function smsLane(store: SmsOutboxStore, provider: SmsProvider): RetryLane {
  return {
    findRetryable: (organizationId, now, ids) => store.findRetryable(organizationId, now, ids),
    dispatch: (id, mode, now) => dispatchSms(store, provider, id, mode, now),
  };
}

// ── Prisma-backed store ──────────────────────────────────────

export function createPrismaSmsOutboxStore(prisma: Pick<PrismaClient, "notification">): SmsOutboxStore {
  return {
    ...createPrismaRowOps(prisma, "SMS"),

    async insert(sms) {
      try {
        return await prisma.notification.create({
          data: {
            organizationId: sms.organizationId,
            userId: sms.userId ?? null,
            deliveryId: sms.deliveryId ?? null,
            type: sms.type,
            channel: "SMS",
            title: sms.title,
            body: sms.text,
            recipientPhone: sms.recipientPhone,
            status: "PENDING",
            dedupeKey: sms.dedupeKey ?? null,
          },
          select: { id: true },
        });
      } catch (e) {
        if (isDedupeConflict(e)) return null;
        throw e;
      }
    },

    async get(id) {
      const row = await prisma.notification.findUnique({
        where: { id },
        select: { id: true, recipientPhone: true, body: true },
      });
      return row ? { id: row.id, recipientPhone: row.recipientPhone, text: row.body } : null;
    },
  };
}
