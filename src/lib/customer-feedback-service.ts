import { db } from "@/lib/db";
import { ApiError, readJson } from "@/lib/api-helpers";
import { clientIp } from "@/lib/account";
import { recordFailure, retryAfter } from "@/lib/rate-limit";
import type { SessionUser } from "@/lib/auth";
import { STATUS_LABELS, type DeliveryStatus } from "@/lib/constants";
import { TX_OPTIONS, lockDelivery } from "@/lib/delivery";
import { auditData, bestEffort, notifyAdmins, notifyEmail } from "@/lib/notify";
import { orgHasFeature } from "@/lib/plans";
import { customerRescheduleEmail, trackingUrl } from "@/lib/email/templates";
import { deliveryLoader, dispatchWebhooksSoon, queueDeliveryStatusChange, queueWebhookEvent } from "@/lib/webhooks";
import { isValidTrackingToken } from "@/lib/tracking";
import {
  ACCEPTABLE_STATUSES,
  checkRescheduleDate,
  dayKeyInTz,
  describeReschedule,
  isRescheduleWindow,
  ratingBlock,
  rescheduleBlock,
  stars,
  windowDeadline,
  type RatingBlock,
  type RatingInput,
  type RescheduleBlock,
  type RescheduleRequestInput,
  type RescheduleResolveInput,
} from "@/lib/customer-feedback";

// ─────────────────────────────────────────────────────────────
// Customer feedback — server side. Rules: src/lib/customer-feedback.ts.
//
//   submitRating        POST /api/track/[token]/rating      (public)
//   requestReschedule   POST /api/track/[token]/reschedule  (public)
//   resolveReschedule   POST /api/deliveries/[id]/reschedule (admin/dispatcher)
//
// Every change locks the delivery row first (same as the status machine),
// writes its DeliveryEvent and queues its webhook in the same transaction;
// notifications go out after commit and never fail the request.
// ─────────────────────────────────────────────────────────────

/** A refusal the public page translates by `code` (the message is English, for API callers). */
export class FeedbackError extends ApiError {
  constructor(
    status: number,
    readonly code: string,
    message: string
  ) {
    super(status, message);
  }
}

const RATING_REFUSALS: Record<RatingBlock, [number, string]> = {
  disabled: [403, "This company doesn't collect ratings"],
  not_delivered: [409, "You can rate the delivery once it has been delivered"],
  already_rated: [409, "This delivery has already been rated"],
  expired: [409, "Ratings close 14 days after delivery"],
};

const RESCHEDULE_REFUSALS: Record<RescheduleBlock, [number, string]> = {
  disabled: [403, "This company doesn't take reschedule requests online"],
  not_eligible: [409, "This delivery can no longer be rescheduled"],
  pending: [409, "A reschedule request is already waiting for an answer"],
  limit: [409, "This delivery has reached the limit of reschedule requests — please contact the sender"],
};

/** The delivery behind a public tracking link (404 unknown, 410 revoked). */
async function deliveryForToken(token: string): Promise<{ id: string; organizationId: string }> {
  if (!isValidTrackingToken(token)) throw new FeedbackError(404, "not_found", "Tracking link not found");
  const d = await db.delivery.findUnique({ where: { trackingToken: token }, select: { id: true, organizationId: true, trackingEnabled: true } });
  if (!d) throw new FeedbackError(404, "not_found", "Tracking link not found");
  if (!d.trackingEnabled) throw new FeedbackError(410, "revoked", "This tracking link has been revoked");
  return { id: d.id, organizationId: d.organizationId };
}

// ── rating ───────────────────────────────────────────────────

export async function submitRating(token: string, input: RatingInput, now = new Date()) {
  const { id, organizationId } = await deliveryForToken(token);

  const result = await db.$transaction(async (tx) => {
    await lockDelivery(tx, id, organizationId);
    const d = await tx.delivery.findUniqueOrThrow({
      where: { id },
      select: { status: true, completedAt: true, rating: true, trackingCode: true, organization: { select: { allowCustomerRating: true } } },
    });
    const block = ratingBlock(
      { status: d.status, completedAt: d.completedAt, rating: d.rating, allowCustomerRating: d.organization.allowCustomerRating },
      now
    );
    if (block) throw new FeedbackError(RATING_REFUSALS[block][0], block, RATING_REFUSALS[block][1]);

    await tx.delivery.update({ where: { id }, data: { rating: input.rating, ratingComment: input.comment, ratedAt: now } });
    // Internal timeline entry — the customer already sees their stars on the page.
    await tx.deliveryEvent.create({
      data: {
        deliveryId: id,
        eventType: "RATED",
        actorName: "Customer",
        note: `${stars(input.rating)} ${input.rating}/5${input.comment ? ` — “${input.comment}”` : ""}`,
        customerVisible: false,
      },
    });
    const load = deliveryLoader(tx, id);
    await queueWebhookEvent(tx, organizationId, "delivery.rated", async () => ({
      delivery: await load(),
      rating: { score: input.rating, comment: input.comment, ratedAt: now.toISOString() },
    }));
    return { trackingCode: d.trackingCode };
  }, TX_OPTIONS);

  // A poor rating is worth a look the same day (in-app only).
  if (input.rating <= 2) {
    await bestEffort("rating: admin notification", () =>
      notifyAdmins(organizationId, {
        type: "RATED",
        title: `Low rating · ${result.trackingCode}`,
        body: `The customer rated ${result.trackingCode} ${input.rating}/5${input.comment ? `: “${input.comment.slice(0, 160)}”` : "."}`,
        deliveryId: id,
      })
    );
  }
  dispatchWebhooksSoon(organizationId);
  return { rating: input.rating, ratedAt: now.toISOString() };
}

// ── reschedule request (customer) ────────────────────────────

export async function requestReschedule(token: string, input: RescheduleRequestInput, now = new Date()) {
  const { id, organizationId } = await deliveryForToken(token);

  const result = await db.$transaction(async (tx) => {
    await lockDelivery(tx, id, organizationId);
    const d = await tx.delivery.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        trackingCode: true,
        rescheduleStatus: true,
        organization: { select: { timezone: true, allowCustomerReschedule: true } },
        _count: { select: { events: { where: { eventType: "RESCHEDULE_REQUESTED" } } } },
      },
    });
    const block = rescheduleBlock({
      status: d.status,
      rescheduleStatus: d.rescheduleStatus,
      allowCustomerReschedule: d.organization.allowCustomerReschedule,
      requestCount: d._count.events,
    });
    if (block) throw new FeedbackError(RESCHEDULE_REFUSALS[block][0], block, RESCHEDULE_REFUSALS[block][1]);

    const tz = d.organization.timezone;
    const date = checkRescheduleDate(input.date, input.window, tz, now);
    if (!date.ok) throw new FeedbackError(400, date.code, "Choose a day from tomorrow to 14 days ahead");

    await tx.delivery.update({
      where: { id },
      data: {
        rescheduleStatus: "PENDING",
        rescheduleRequestedFor: date.requestedFor,
        rescheduleWindow: input.window,
        rescheduleNote: input.note,
        rescheduleRequestedAt: now,
        rescheduleResolvedAt: null,
      },
    });
    // Customer-visible: the page shows "You asked to reschedule" (+ their own note).
    const event = await tx.deliveryEvent.create({
      data: { deliveryId: id, eventType: "RESCHEDULE_REQUESTED", actorName: "Customer", note: input.note, customerVisible: true },
    });
    const load = deliveryLoader(tx, id);
    await queueWebhookEvent(tx, organizationId, "delivery.reschedule_requested", async () => ({
      delivery: await load(),
      reschedule: {
        requestedFor: date.requestedFor.toISOString(),
        date: input.date,
        window: input.window,
        note: input.note,
        requestedAt: now.toISOString(),
      },
    }));
    return { trackingCode: d.trackingCode, eventId: event.id, when: describeReschedule(date.requestedFor, input.window, tz), requestedFor: date.requestedFor };
  }, TX_OPTIONS);

  await bestEffort("reschedule: admin notification", () =>
    notifyAdmins(
      organizationId,
      {
        type: "RESCHEDULE_REQUESTED",
        title: `Reschedule requested · ${result.trackingCode}`,
        body: `The customer asked to move ${result.trackingCode} to ${result.when}${input.note ? ` — “${input.note.slice(0, 160)}”` : "."} Accept or decline it in the delivery.`,
        deliveryId: id,
      },
      { email: true, emailDedupeKey: `reschedule:${result.eventId}` }
    )
  );
  dispatchWebhooksSoon(organizationId);
  return { status: "PENDING" as const, requestedFor: result.requestedFor.toISOString(), window: input.window };
}

// ── staff answer ─────────────────────────────────────────────

export async function resolveReschedule(user: SessionUser, deliveryId: string, input: RescheduleResolveInput, now = new Date()) {
  const accept = input.action === "accept";

  const result = await db.$transaction(async (tx) => {
    await lockDelivery(tx, deliveryId, user.organizationId);
    const d = await tx.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
      select: {
        status: true,
        trackingCode: true,
        trackingToken: true,
        trackingEnabled: true,
        recipientName: true,
        recipientEmail: true,
        expectedAt: true,
        rescheduleStatus: true,
        rescheduleRequestedFor: true,
        rescheduleWindow: true,
        organization: { select: { name: true, timezone: true } },
      },
    });
    if (d.rescheduleStatus !== "PENDING" || !d.rescheduleRequestedFor) {
      throw new ApiError(409, "There's no reschedule request waiting on this delivery — refresh to see its latest state");
    }
    const tz = d.organization.timezone;
    const window = isRescheduleWindow(d.rescheduleWindow) ? d.rescheduleWindow : "ANY";

    let expectedAt: Date | null = null;
    let reopened = false;
    if (accept) {
      if (!(ACCEPTABLE_STATUSES as readonly string[]).includes(d.status)) {
        const label = STATUS_LABELS[d.status as DeliveryStatus]?.toLowerCase() ?? d.status;
        throw new ApiError(409, `This delivery is already ${label} — decline the request instead`);
      }
      expectedAt = input.expectedAt ? new Date(input.expectedAt) : windowDeadline(dayKeyInTz(d.rescheduleRequestedFor, tz), window, tz);
      if (!expectedAt || Number.isNaN(expectedAt.getTime())) throw new ApiError(400, "Enter a valid delivery date");
      // A failed delivery goes back to the pending queue for a new driver
      // (FAILED → CREATED, the same reopening the status override allows).
      reopened = d.status === "FAILED";
    }

    await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        rescheduleStatus: accept ? "ACCEPTED" : "DECLINED",
        rescheduleResolvedAt: now,
        ...(accept ? { expectedAt } : {}),
        ...(reopened ? { status: "CREATED", failureReason: null } : {}),
      },
    });
    // The note is the message to the customer — shown on the tracking page.
    const event = await tx.deliveryEvent.create({
      data: {
        deliveryId,
        eventType: accept ? "RESCHEDULE_ACCEPTED" : "RESCHEDULE_DECLINED",
        actorId: user.id,
        actorName: user.name,
        note: input.note,
        customerVisible: true,
      },
    });
    await tx.auditLog.create({
      data: auditData({
        organizationId: user.organizationId,
        actorId: user.id,
        actorName: user.name,
        action: accept ? "RESCHEDULE_ACCEPTED" : "RESCHEDULE_DECLINED",
        entityType: "Delivery",
        entityId: deliveryId,
        detail: {
          trackingCode: d.trackingCode,
          requestedFor: d.rescheduleRequestedFor.toISOString(),
          window,
          ...(accept ? { expectedAt: expectedAt!.toISOString(), previousExpectedAt: d.expectedAt?.toISOString() ?? null, reopened } : {}),
          message: input.note,
        },
      }),
    });
    if (reopened) await queueDeliveryStatusChange(tx, user.organizationId, deliveryId, "FAILED", "CREATED");

    return {
      delivery: d,
      eventId: event.id,
      expectedAt,
      reopened,
      when: accept && input.expectedAt ? describeInstant(expectedAt!, tz) : describeReschedule(d.rescheduleRequestedFor, window, tz),
    };
  }, TX_OPTIONS);

  // The customer hears back by email when the plan includes customer emails.
  const { delivery } = result;
  const to = delivery.recipientEmail?.trim();
  if (to && delivery.trackingEnabled) {
    await bestEffort("reschedule: customer email", async () => {
      if (!(await orgHasFeature(db, user.organizationId, "customer_emails"))) return;
      const content = customerRescheduleEmail({
        companyName: delivery.organization.name,
        recipientName: delivery.recipientName,
        trackingCode: delivery.trackingCode,
        accepted: accept,
        when: result.when,
        message: input.note,
        trackingUrl: trackingUrl(delivery.trackingToken),
      });
      await notifyEmail({
        organizationId: user.organizationId,
        userId: null,
        deliveryId,
        type: accept ? "RESCHEDULE_ACCEPTED" : "RESCHEDULE_DECLINED",
        recipientEmail: to,
        title: content.subject,
        body: content.text,
        dedupeKey: `customer-reschedule:${result.eventId}:${to.toLowerCase()}`,
      });
    });
  }
  if (result.reopened) dispatchWebhooksSoon(user.organizationId);

  return {
    rescheduleStatus: accept ? "ACCEPTED" : "DECLINED",
    expectedAt: result.expectedAt?.toISOString() ?? null,
    reopened: result.reopened,
  };
}

// ── public route wrapper ─────────────────────────────────────

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Shared shell of the public feedback routes: per tracking-link + client IP
 * attempt limit (every attempt counts — RateLimit "track-<scope>:" keys allow
 * 5 per 15 minutes), JSON body + schema check, and `{ error, code }` answers
 * the tracking page translates.
 */
export async function handlePublicFeedback<T>(
  req: Request,
  token: string,
  scope: "rate" | "reschedule",
  parse: (body: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } },
  run: (input: T) => Promise<unknown>
): Promise<Response> {
  try {
    if (!isValidTrackingToken(token)) throw new FeedbackError(404, "not_found", "Tracking link not found");
    const key = `track-${scope}:${token}:${clientIp(req)}`;
    const wait = await retryAfter(key);
    if (wait > 0) {
      return Response.json(
        { error: "Too many attempts — please try again later", code: "rate_limited" },
        { status: 429, headers: { ...NO_STORE, "Retry-After": String(wait) } }
      );
    }
    await recordFailure(key);
    const parsed = parse(await readJson<unknown>(req));
    if (!parsed.success) throw new FeedbackError(400, "invalid", parsed.error.issues[0]?.message ?? "Invalid input");
    const data = await run(parsed.data);
    return Response.json(data, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof FeedbackError) return Response.json({ error: e.message, code: e.code }, { status: e.status, headers: NO_STORE });
    if (e instanceof ApiError) return Response.json({ error: e.message, code: "invalid" }, { status: e.status, headers: NO_STORE });
    console.error(`[track ${scope}] error:`, e);
    return Response.json({ error: "Something went wrong. Please try again later.", code: "error" }, { status: 500, headers: NO_STORE });
  }
}

function describeInstant(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}
