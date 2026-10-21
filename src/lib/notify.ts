import { db } from "@/lib/db";
import { getEmailProvider } from "@/lib/email";
import { createPrismaOutboxStore, queueAndSend, retryEmails } from "@/lib/email/outbox";
import { customerDeliveredEmail, customerFailedEmail, customerTrackingEmail, trackingUrl } from "@/lib/email/templates";

// ─────────────────────────────────────────────────────────────
// Notifications (in-app + email outbox) & Audit trail
// Email rows go through the outbox state machine in src/lib/email/outbox.ts
// and are sent by the provider chosen in src/lib/email/index.ts.
// ─────────────────────────────────────────────────────────────

interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  deliveryId?: string | null;
}

/** Create an in-app notification for a single user. */
export async function notifyInApp(input: NotifyInput) {
  return db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      channel: "IN_APP",
      title: input.title,
      body: input.body,
      deliveryId: input.deliveryId ?? null,
    },
  });
}

const outbox = createPrismaOutboxStore(db);

export interface NotifyEmailInput {
  organizationId: string;
  /** null for people without an account (delivery recipients) */
  userId?: string | null;
  recipientEmail: string;
  type: string;
  /** subject line */
  title: string;
  /** plain-text body */
  body: string;
  deliveryId?: string | null;
  /** Event-specific key (e.g. `assigned:<assignmentId>:<userId>`): repeats are skipped. */
  dedupeKey?: string | null;
}

/**
 * Queue an email (Notification row, status PENDING) and send it right away
 * through the configured provider. Call after the mutation has committed,
 * inside bestEffort. Provider failures are recorded on the row (FAILED +
 * lastError) and can be retried from the outbox; they never throw.
 */
export async function notifyEmail(input: NotifyEmailInput) {
  return queueAndSend(outbox, getEmailProvider(), {
    organizationId: input.organizationId,
    userId: input.userId ?? null,
    deliveryId: input.deliveryId ?? null,
    type: input.type,
    recipientEmail: input.recipientEmail,
    subject: input.title,
    text: input.body,
    dedupeKey: input.dedupeKey ?? null,
  });
}

/** Re-dispatch an organization's FAILED / stale rows (see retryEmails). */
export function retryOrganizationEmails(organizationId: string, ids?: string[]) {
  return retryEmails(outbox, getEmailProvider(), organizationId, { ids });
}

/**
 * Notify every active admin/dispatcher of an organization.
 * With `email`, admins also get an email; pass `emailDedupeKey` (an event key
 * like `delivered:<deliveryId>`) so a repeat of the same event is not re-sent —
 * it is suffixed with each admin's id.
 */
export async function notifyAdmins(
  organizationId: string,
  input: Omit<NotifyInput, "userId">,
  opts: { email?: boolean; emailDedupeKey?: string } = {}
) {
  const admins = await db.user.findMany({
    where: { organizationId, role: "ADMIN", active: true },
    select: { id: true, email: true },
  });
  await Promise.all(
    admins.map((a) => {
      const payload = { ...input, userId: a.id };
      const ops: Promise<unknown>[] = [notifyInApp(payload)];
      if (opts.email) {
        ops.push(
          notifyEmail({
            ...payload,
            organizationId,
            title: `[FleetFlow] ${input.title}`,
            recipientEmail: a.email,
            dedupeKey: opts.emailDedupeKey ? `${opts.emailDedupeKey}:${a.id}` : null,
          })
        );
      }
      return Promise.all(ops);
    })
  );
}

async function companyName(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  return org?.name?.trim() || "Your sender";
}

export interface CustomerTrackingEmailInput {
  organizationId: string;
  deliveryId: string;
  trackingCode: string;
  trackingToken: string;
  recipientName: string;
  recipientEmail: string | null;
}

/**
 * Email the delivery recipient their public tracking link (no-op when the
 * delivery has no recipient email). Call after the create has committed.
 */
export async function sendCustomerTrackingEmail(input: CustomerTrackingEmailInput): Promise<void> {
  const to = input.recipientEmail?.trim();
  if (!to) return;
  const content = customerTrackingEmail({
    companyName: await companyName(input.organizationId),
    recipientName: input.recipientName,
    trackingCode: input.trackingCode,
    trackingUrl: trackingUrl(input.trackingToken),
  });
  await notifyEmail({
    organizationId: input.organizationId,
    userId: null,
    deliveryId: input.deliveryId,
    type: "TRACKING",
    recipientEmail: to,
    title: content.subject,
    body: content.text,
    dedupeKey: `customer-tracking:${input.deliveryId}:${to.toLowerCase()}`,
  });
}

export interface CustomerOutcomeEmailInput {
  organizationId: string;
  delivery: {
    id: string;
    trackingCode: string;
    trackingToken: string;
    recipientName: string;
    recipientEmail: string | null;
  };
  outcome: "DELIVERED" | "FAILED";
  /** Event key, e.g. `delivered:<deliveryId>` or `failed:<eventId>`; the recipient is appended. */
  eventKey: string;
}

/**
 * Tell the delivery recipient (if they have an email) that it was delivered,
 * or — neutrally, without internal reasons — that the attempt was unsuccessful.
 */
export async function sendCustomerOutcomeEmail(input: CustomerOutcomeEmailInput): Promise<void> {
  const to = input.delivery.recipientEmail?.trim();
  if (!to) return;
  const base = {
    companyName: await companyName(input.organizationId),
    recipientName: input.delivery.recipientName,
    trackingCode: input.delivery.trackingCode,
  };
  const content =
    input.outcome === "DELIVERED"
      ? customerDeliveredEmail({ ...base, trackingUrl: trackingUrl(input.delivery.trackingToken) })
      : customerFailedEmail(base);
  await notifyEmail({
    organizationId: input.organizationId,
    userId: null,
    deliveryId: input.delivery.id,
    type: input.outcome,
    recipientEmail: to,
    title: content.subject,
    body: content.text,
    dedupeKey: `customer-${input.eventKey}:${to.toLowerCase()}`,
  });
}

interface AuditInput {
  organizationId: string;
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  detail?: Record<string, unknown> | null;
}

/** Append-only audit record. Should be called inside the same transaction
 *  as the mutation it describes when possible. */
export function auditData(input: AuditInput) {
  return {
    organizationId: input.organizationId,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    detail: input.detail ? JSON.stringify(input.detail) : null,
  };
}

/**
 * Run post-commit side effects (notifications) without failing the request:
 * the mutation already succeeded, so a notification error is only logged.
 */
export async function bestEffort(label: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (e) {
    console.error(`[notify] ${label} failed:`, e);
  }
}
