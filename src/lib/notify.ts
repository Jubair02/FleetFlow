import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────
// Notifications (in-app + simulated email outbox) & Audit trail
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

/**
 * Create an "email" notification. In this sandbox there is no SMTP provider,
 * so outbound email is captured in an outbox (Notification rows with
 * channel=EMAIL) that admins can inspect. Swap this for a real provider
 * (Resend/SendGrid/SES) by transmitting here while keeping the record.
 */
export async function notifyEmail(input: NotifyInput & { recipientEmail: string }) {
  return db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      channel: "EMAIL",
      title: input.title,
      body: input.body,
      recipientEmail: input.recipientEmail,
      deliveryId: input.deliveryId ?? null,
    },
  });
}

/** Notify every active admin/dispatcher of an organization. */
export async function notifyAdmins(
  organizationId: string,
  input: Omit<NotifyInput, "userId">,
  opts: { email?: boolean } = {}
) {
  const admins = await db.user.findMany({
    where: { organizationId, role: "ADMIN", active: true },
    select: { id: true, email: true },
  });
  await Promise.all(
    admins.map((a) => {
      const payload = { ...input, userId: a.id };
      const ops = [notifyInApp(payload)];
      if (opts.email) ops.push(notifyEmail({ ...payload, recipientEmail: a.email }));
      return Promise.all(ops);
    })
  );
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
