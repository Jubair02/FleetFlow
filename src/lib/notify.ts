import { db } from "@/lib/db";
import { getEmailProvider } from "@/lib/email";
import {
  createPrismaOutboxStore,
  dispatchEmail,
  emailLane,
  findDueRows,
  queueAndSend,
  retryDueOutbox,
  retryOutbox,
} from "@/lib/email/outbox";
import type { FeatureKey } from "@/lib/plan-catalog";
import { customerDeliveredEmail, customerFailedEmail, customerTrackingEmail, trackingUrl } from "@/lib/email/templates";
import { getSmsProvider } from "@/lib/sms";
import { createPrismaSmsOutboxStore, dispatchSms, queueAndSendSms, smsLane } from "@/lib/sms/outbox";
import { normalizeBdPhone } from "@/lib/sms/phone";
import { customerDeliveredSms, customerFailedSms, customerTrackingSms } from "@/lib/sms/templates";

// ─────────────────────────────────────────────────────────────
// Notifications (in-app + email/SMS outbox) & Audit trail
// Email and SMS rows go through the outbox state machine in
// src/lib/email/outbox.ts and are sent by the providers chosen in
// src/lib/email/index.ts and src/lib/sms/index.ts.
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

const smsOutbox = createPrismaSmsOutboxStore(db);

export interface NotifySmsInput {
  organizationId: string;
  userId?: string | null;
  /** canonical 8801XXXXXXXXX (normalizeBdPhone) */
  recipientPhone: string;
  type: string;
  /** outbox label shown to admins (not texted) */
  title: string;
  /** the text message */
  body: string;
  deliveryId?: string | null;
  dedupeKey?: string | null;
}

/** Queue an SMS and send it right away — same contract as notifyEmail. */
export async function notifySms(input: NotifySmsInput) {
  return queueAndSendSms(smsOutbox, getSmsProvider(), {
    organizationId: input.organizationId,
    userId: input.userId ?? null,
    deliveryId: input.deliveryId ?? null,
    type: input.type,
    recipientPhone: input.recipientPhone,
    title: input.title,
    text: input.body,
    dedupeKey: input.dedupeKey ?? null,
  });
}

/** Re-dispatch an organization's FAILED / stale email and SMS rows (see retryOutbox). */
export function retryOrganizationOutbox(organizationId: string, ids?: string[]) {
  return retryOutbox([emailLane(outbox, getEmailProvider()), smsLane(smsOutbox, getSmsProvider())], organizationId, { ids });
}

/**
 * Automatic retry for every organization (GET /api/cron/outbox): FAILED rows
 * past their backoff and stale PENDING/SENDING rows, bounded per run.
 */
export function retryDueNotifications(opts: { now?: Date; limit?: number } = {}) {
  return retryDueOutbox(
    (now, limit) => findDueRows(db, now, limit),
    {
      EMAIL: (id, now) => dispatchEmail(outbox, getEmailProvider(), id, "retry", now),
      SMS: (id, now) => dispatchSms(smsOutbox, getSmsProvider(), id, "retry", now),
    },
    opts
  );
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
    where: { organizationId, role: { in: ["ADMIN", "DISPATCHER"] }, active: true },
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

const CUSTOMER_EMAILS: FeatureKey = "customer_emails";
const CUSTOMER_SMS: FeatureKey = "customer_sms";

interface CustomerChannels {
  /** company name used as the sender */
  sender: string;
  email: boolean;
  sms: boolean;
}

/**
 * Which customer channels the organization's plan includes (customer_emails,
 * customer_sms) and the sender name. A channel the plan lacks is skipped
 * silently — not an error. Staff/driver/admin notifications are never gated.
 */
async function customerChannels(organizationId: string): Promise<CustomerChannels | null> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, planRecord: { select: { features: true } } },
  });
  if (!org) return null;
  const features: string[] = org.planRecord?.features ?? [];
  return {
    sender: org.name?.trim() || "Your sender",
    email: features.includes(CUSTOMER_EMAILS),
    sms: features.includes(CUSTOMER_SMS),
  };
}

interface CustomerSmsInput {
  organizationId: string;
  deliveryId: string;
  /** undefined = look it up on the delivery (callers that don't have it at hand) */
  recipientPhone: string | null | undefined;
  type: string;
  title: string;
  body: string;
  /** e.g. `tracking:<deliveryId>`, `delivered:<deliveryId>`, `failed:<eventId>` */
  eventKey: string;
}

/** Text the delivery recipient. No-op when the number isn't a valid Bangladesh mobile. */
async function sendCustomerSms(input: CustomerSmsInput): Promise<void> {
  const raw =
    input.recipientPhone !== undefined
      ? input.recipientPhone
      : (await db.delivery.findUnique({ where: { id: input.deliveryId }, select: { recipientPhone: true } }))?.recipientPhone;
  const phone = normalizeBdPhone(raw);
  if (!phone) return; // missing or not a BD mobile number: skip, never an error
  await notifySms({
    organizationId: input.organizationId,
    userId: null,
    deliveryId: input.deliveryId,
    type: input.type,
    recipientPhone: phone,
    title: input.title,
    body: input.body,
    dedupeKey: `sms:${input.eventKey}:${phone}`,
  });
}

export interface CustomerTrackingEmailInput {
  organizationId: string;
  deliveryId: string;
  trackingCode: string;
  trackingToken: string;
  recipientName: string;
  recipientEmail: string | null;
  /** For the tracking SMS; when omitted it is read from the delivery. */
  recipientPhone?: string | null;
}

/**
 * Send the delivery recipient their public tracking link: by email (if the
 * delivery has a recipient email and the plan has customer_emails) and by
 * SMS (if it has a valid BD mobile number and the plan has customer_sms).
 * Call after the create has committed.
 */
export async function sendCustomerTrackingEmail(input: CustomerTrackingEmailInput): Promise<void> {
  const to = input.recipientEmail?.trim();
  if (!to && input.recipientPhone !== undefined && !normalizeBdPhone(input.recipientPhone)) return;
  const channels = await customerChannels(input.organizationId);
  if (!channels) return;
  const url = trackingUrl(input.trackingToken);

  const sendEmail = async () => {
    if (!to || !channels.email) return;
    const content = customerTrackingEmail({
      companyName: channels.sender,
      recipientName: input.recipientName,
      trackingCode: input.trackingCode,
      trackingUrl: url,
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
  };
  // SMS problems are logged, never surfaced through the email path
  const sendSms = () =>
    channels.sms
      ? bestEffort("customer tracking sms", () =>
          sendCustomerSms({
            organizationId: input.organizationId,
            deliveryId: input.deliveryId,
            recipientPhone: input.recipientPhone,
            type: "TRACKING",
            title: `Tracking link · ${input.trackingCode}`,
            body: customerTrackingSms({ companyName: channels.sender, trackingCode: input.trackingCode, trackingUrl: url }),
            eventKey: `tracking:${input.deliveryId}`,
          })
        )
      : Promise.resolve();

  await Promise.all([sendEmail(), sendSms()]);
}

export interface CustomerOutcomeEmailInput {
  organizationId: string;
  delivery: {
    id: string;
    trackingCode: string;
    trackingToken: string;
    recipientName: string;
    recipientEmail: string | null;
    /** For the outcome SMS; when omitted it is read from the delivery. */
    recipientPhone?: string | null;
  };
  outcome: "DELIVERED" | "FAILED";
  /** Event key, e.g. `delivered:<deliveryId>` or `failed:<eventId>`; the recipient is appended. */
  eventKey: string;
}

/**
 * Tell the delivery recipient (by email and/or SMS, per plan) that it was
 * delivered, or — neutrally, without internal reasons — that the attempt
 * was unsuccessful.
 */
export async function sendCustomerOutcomeEmail(input: CustomerOutcomeEmailInput): Promise<void> {
  const { delivery } = input;
  const to = delivery.recipientEmail?.trim();
  if (!to && delivery.recipientPhone !== undefined && !normalizeBdPhone(delivery.recipientPhone)) return;
  const channels = await customerChannels(input.organizationId);
  if (!channels) return;
  const url = trackingUrl(delivery.trackingToken);

  const sendEmail = async () => {
    if (!to || !channels.email) return;
    const base = {
      companyName: channels.sender,
      recipientName: delivery.recipientName,
      trackingCode: delivery.trackingCode,
    };
    const content =
      input.outcome === "DELIVERED" ? customerDeliveredEmail({ ...base, trackingUrl: url }) : customerFailedEmail(base);
    await notifyEmail({
      organizationId: input.organizationId,
      userId: null,
      deliveryId: delivery.id,
      type: input.outcome,
      recipientEmail: to,
      title: content.subject,
      body: content.text,
      dedupeKey: `customer-${input.eventKey}:${to.toLowerCase()}`,
    });
  };
  const sendSms = () => {
    if (!channels.sms) return Promise.resolve();
    const smsInput = { companyName: channels.sender, trackingCode: delivery.trackingCode, trackingUrl: url };
    const delivered = input.outcome === "DELIVERED";
    return bestEffort("customer outcome sms", () =>
      sendCustomerSms({
        organizationId: input.organizationId,
        deliveryId: delivery.id,
        recipientPhone: delivery.recipientPhone,
        type: input.outcome,
        title: `${delivered ? "Delivered" : "Delivery not completed"} · ${delivery.trackingCode}`,
        body: delivered ? customerDeliveredSms(smsInput) : customerFailedSms(smsInput),
        eventKey: input.eventKey,
      })
    );
  };

  await Promise.all([sendEmail(), sendSms()]);
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
