import { db } from "@/lib/db";
import { ApiError, fail, ok, readJson, requireAdmin } from "@/lib/api-helpers";
import { firstError } from "@/lib/validation";
import { TX_OPTIONS } from "@/lib/delivery";
import { auditData } from "@/lib/notify";
import { assertFeature, toPlanDefinition } from "@/lib/plans";
import { BRANDED_TRACKING_FEATURE, brandLogoUrl, type TrackingSettingsResponse } from "@/lib/branding";
import { trackingSettingsSchema } from "@/lib/customer-feedback";
import type { Prisma } from "@prisma/client";

const FIELDS = {
  id: true,
  name: true,
  phone: true,
  brandColor: true,
  brandLogoKey: true,
  trackingMessage: true,
  allowCustomerRating: true,
  allowCustomerReschedule: true,
} as const;

type Row = Prisma.OrganizationGetPayload<{ select: typeof FIELDS }>;

function serialize(o: Row, plan: { name: string; features: string[] }): TrackingSettingsResponse {
  return {
    settings: {
      brandColor: o.brandColor,
      trackingMessage: o.trackingMessage,
      logoUrl: o.brandLogoKey ? brandLogoUrl(o.id, o.brandLogoKey) : null,
      allowCustomerRating: o.allowCustomerRating,
      allowCustomerReschedule: o.allowCustomerReschedule,
    },
    branded: plan.features.includes(BRANDED_TRACKING_FEATURE),
    planName: plan.name,
    company: { name: o.name, phone: o.phone },
  };
}

async function load(organizationId: string): Promise<TrackingSettingsResponse> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { ...FIELDS, planRecord: true } });
  if (!org) throw new ApiError(404, "Organization not found");
  const { planRecord, ...row } = org;
  return serialize(row, toPlanDefinition(planRecord));
}

// GET /api/settings/tracking — tracking-page branding and customer feedback switches (admin).
export async function GET() {
  try {
    const user = await requireAdmin();
    return ok(await load(user.organizationId));
  } catch (e) {
    return fail(e);
  }
}

/**
 * PATCH /api/settings/tracking — { brandColor?, trackingMessage?, allowCustomerRating?, allowCustomerReschedule? } (admin).
 * Setting a colour or message needs the branded_tracking plan feature; clearing
 * them and the two customer switches work on every plan. The logo has its own
 * route (/api/settings/tracking/logo). Audited.
 */
export async function PATCH(req: Request) {
  try {
    const user = await requireAdmin();
    const parsed = trackingSettingsSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) throw new ApiError(400, firstError(parsed.error));
    const input = parsed.data;

    const changed = await db.$transaction(async (tx) => {
      const current = await tx.organization.findUnique({ where: { id: user.organizationId }, select: FIELDS });
      if (!current) throw new ApiError(404, "Organization not found");

      const data: Prisma.OrganizationUpdateInput = {};
      if (input.brandColor !== undefined && input.brandColor !== current.brandColor) data.brandColor = input.brandColor;
      if (input.trackingMessage !== undefined && input.trackingMessage !== current.trackingMessage) data.trackingMessage = input.trackingMessage;
      if (input.allowCustomerRating !== undefined && input.allowCustomerRating !== current.allowCustomerRating) {
        data.allowCustomerRating = input.allowCustomerRating;
      }
      if (input.allowCustomerReschedule !== undefined && input.allowCustomerReschedule !== current.allowCustomerReschedule) {
        data.allowCustomerReschedule = input.allowCustomerReschedule;
      }
      const keys = Object.keys(data);
      if (keys.length === 0) return keys;

      // Branding is a plan feature — only adding/changing it is gated, never removing it.
      if (data.brandColor || data.trackingMessage) await assertFeature(tx, user.organizationId, BRANDED_TRACKING_FEATURE);

      await tx.organization.update({ where: { id: user.organizationId }, data });
      await tx.auditLog.create({
        data: auditData({
          organizationId: user.organizationId,
          actorId: user.id,
          actorName: user.name,
          action: "TRACKING_SETTINGS_UPDATED",
          entityType: "Organization",
          entityId: user.organizationId,
          detail: { changed: keys, ...data },
        }),
      });
      return keys;
    }, TX_OPTIONS);

    return ok({ ...(await load(user.organizationId)), changed });
  } catch (e) {
    return fail(e);
  }
}
