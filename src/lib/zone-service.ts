import type { DeliveryZone, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import { planCharge, ZoneChoiceError, type ChargeEdit, type ChargePlan, type ChargeState, type ZoneRule } from "@/lib/zones";

// ─────────────────────────────────────────────────────────────
// Database side of delivery zones (rules: src/lib/zones.ts). Every query is
// scoped to one organization.
// ─────────────────────────────────────────────────────────────

type Client = Prisma.TransactionClient | typeof db;

export const ZONE_RULE_SELECT = {
  id: true,
  name: true,
  areas: true,
  baseFeeBdt: true,
  includedKg: true,
  perExtraKgBdt: true,
  codFeePercent: true,
  codFeeMinBdt: true,
  isDefault: true,
  sortOrder: true,
  active: true,
} satisfies Prisma.DeliveryZoneSelect;

/** All of the organization's zones (inactive included), in matching order. */
export function loadZones(client: Client, organizationId: string): Promise<ZoneRule[]> {
  return client.deliveryZone.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: ZONE_RULE_SELECT,
  });
}

/** planCharge() with the organization's zones; an unknown/inactive manual zone is a 400. */
export function planChargeWith(zones: readonly ZoneRule[], current: ChargeState, edit: ChargeEdit): ChargePlan {
  try {
    return planCharge(current, edit, zones);
  } catch (e) {
    if (e instanceof ZoneChoiceError) throw new ApiError(400, "Choose an active delivery zone (the selected one doesn't exist or is turned off)");
    throw e;
  }
}

export async function chargeFor(client: Client, organizationId: string, current: ChargeState, edit: ChargeEdit): Promise<ChargePlan> {
  return planChargeWith(await loadZones(client, organizationId), current, edit);
}

/** Fields of a ChargeEdit that were actually sent. */
export function hasChargeInput(edit: ChargeEdit): boolean {
  return (["deliveryAddress", "weightKg", "codAmount", "zoneId", "deliveryFeeBdt"] as const).some((k) => edit[k] !== undefined);
}

export function zoneRule(z: DeliveryZone): ZoneRule {
  return {
    id: z.id,
    name: z.name,
    areas: z.areas,
    baseFeeBdt: z.baseFeeBdt,
    includedKg: z.includedKg,
    perExtraKgBdt: z.perExtraKgBdt,
    codFeePercent: z.codFeePercent,
    codFeeMinBdt: z.codFeeMinBdt,
    isDefault: z.isDefault,
    sortOrder: z.sortOrder,
    active: z.active,
  };
}
