// ─────────────────────────────────────────────────────────────
// Delivery zones & charges — PURE (no database, no React), shared by the
// API routes, the delivery form preview and the unit tests. docs/ZONES.md
// explains the rules to humans.
//
// Matching
//   The address and every area keyword are normalized the same way:
//   lower case, Bangla digits → ASCII, letters and digits split apart
//   ("Mirpur-10", "Mirpur10" → "mirpur 10"), every run of punctuation /
//   spaces → one space. A keyword matches when its words appear as whole,
//   consecutive words of the address: "Mirpur" matches "Mirpur 10" and
//   "Mirpur-10, Dhaka" but not "Mirpurkhas"; "Mirpur 10" does not match
//   "Mirpur 1". Bangla keywords work the same way (whole words).
//   Zones are tried in sortOrder (then name); the first ACTIVE zone with a
//   matching keyword wins. Otherwise the active default zone is used.
//   No match and no default (or no zones at all) → no zone and no fee.
//
// Fee (whole taka)
//   baseFeeBdt
//   + ceil(max(0, weightKg − includedKg)) × perExtraKgBdt
//   + (codAmount > 0 ? max(codFeeMinBdt, round(codAmount × codFeePercent / 100)) : 0)
//
// Re-pricing (planCharge)
//   Staff may pick the zone (overrides matching) and/or type the fee
//   (feeOverridden — never recalculated). Otherwise the fee is recalculated
//   on create and whenever the address, weight, COD amount or zone change.
//   Finished deliveries (DELIVERED / FAILED / CANCELLED) keep their zone and
//   fee unless the zone or fee is edited explicitly.
// ─────────────────────────────────────────────────────────────

/** The pricing rule of a zone (a DeliveryZone row, or its DTO). */
export interface ZoneRule {
  id: string;
  name: string;
  areas: string[];
  baseFeeBdt: number;
  includedKg: number;
  perExtraKgBdt: number;
  codFeePercent: number;
  codFeeMinBdt: number;
  isDefault: boolean;
  sortOrder: number;
  active: boolean;
}

export interface FeeBreakdown {
  baseBdt: number;
  /** Whole kilograms charged above includedKg. */
  extraKg: number;
  weightBdt: number;
  codBdt: number;
  totalBdt: number;
}

/** How the zone was chosen. */
export type ZoneMatchKind = "manual" | "area" | "default" | "none";

export interface ZoneMatch<Z extends ZoneRule = ZoneRule> {
  zone: Z | null;
  kind: ZoneMatchKind;
  /** The keyword that matched (kind "area"). */
  matchedArea: string | null;
}

/** GET /api/zones item. */
export interface ZoneItem extends ZoneRule {
  /** Open (not finished) deliveries currently in this zone. */
  openDeliveries: number;
  createdAt: string;
  updatedAt: string;
}

export interface ZonesResponse {
  items: ZoneItem[];
}

/** POST /api/zones/preview answer. */
export interface ZonePreview {
  zone: { id: string; name: string } | null;
  kind: ZoneMatchKind;
  matchedArea: string | null;
  fee: FeeBreakdown | null;
  /** False when the organization has no active zones (nothing to price with). */
  zonesConfigured: boolean;
}

export const FINAL_STATUSES =["DELIVERED", "FAILED", "CANCELLED"] as const;
export const OPEN_STATUSES = ["CREATED", "ASSIGNED", "PICKED_UP", "IN_TRANSIT"] as const;

export const ZONE_LIMITS = {
  nameMax: 60,
  areaMin: 2,
  areaMax: 60,
  areasMax: 300,
  feeMax: 100_000,
  kgMax: 1_000,
  zonesMax: 100,
} as const;

// ── Normalization & matching ─────────────────────────────────

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

/**
 * Comparison form of an address or keyword: lower case, Bangla digits as
 * ASCII, letters/digits split apart, punctuation and spaces collapsed.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)))
    .replace(/([\p{L}\p{M}])(\p{N})/gu, "$1 $2")
    .replace(/(\p{N})([\p{L}\p{M}])/gu, "$1 $2")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

/** True when `keyword`'s words appear as whole consecutive words of `address`. */
export function areaMatches(address: string, keyword: string): boolean {
  const k = normalizeForMatch(keyword);
  if (!k) return false;
  return ` ${normalizeForMatch(address)} `.includes(` ${k} `);
}

/** Zones in matching order: sortOrder, then name. */
export function sortZones<Z extends ZoneRule>(zones: readonly Z[]): Z[] {
  return [...zones].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** The first active zone with a matching keyword, else the active default zone, else none. */
export function matchZone<Z extends ZoneRule>(zones: readonly Z[], address: string): ZoneMatch<Z> {
  const active = sortZones(zones.filter((z) => z.active));
  const addr = ` ${normalizeForMatch(address)} `;
  if (addr.trim()) {
    for (const zone of active) {
      for (const area of zone.areas) {
        const k = normalizeForMatch(area);
        if (k && addr.includes(` ${k} `)) return { zone, kind: "area", matchedArea: area };
      }
    }
  }
  const fallback = active.find((z) => z.isDefault) ?? null;
  return fallback ? { zone: fallback, kind: "default", matchedArea: null } : { zone: null, kind: "none", matchedArea: null };
}

/**
 * Zone for a delivery: the manually chosen one when `zoneId` is given (it
 * must be in `zones` and active — otherwise null is returned with kind
 * "manual" so the caller can reject it), else matchZone().
 */
export function resolveZone<Z extends ZoneRule>(zones: readonly Z[], address: string, zoneId?: string | null): ZoneMatch<Z> {
  if (zoneId) {
    const zone = zones.find((z) => z.id === zoneId && z.active) ?? null;
    return { zone, kind: "manual", matchedArea: null };
  }
  return matchZone(zones, address);
}

// ── Fee ──────────────────────────────────────────────────────

type FeeRule = Pick<ZoneRule, "baseFeeBdt" | "includedKg" | "perExtraKgBdt" | "codFeePercent" | "codFeeMinBdt">;

/** Whole kilograms charged above `includedKg` (rounded up; float noise below 1 g is ignored). */
export function extraKilograms(weightKg: number | null | undefined, includedKg: number): number {
  if (!weightKg || !(weightKg > 0)) return 0;
  const over = Math.round((weightKg - Math.max(0, includedKg)) * 1000) / 1000;
  return over > 0 ? Math.ceil(over) : 0;
}

/** COD handling fee: max(minimum, round(amount × percent / 100)); 0 for prepaid. */
export function codFee(codAmount: number | null | undefined, percent: number, minBdt: number): number {
  if (!codAmount || !(codAmount > 0)) return 0;
  return Math.max(Math.max(0, minBdt), Math.round((codAmount * Math.max(0, percent)) / 100));
}

export function calculateFee(zone: FeeRule, input: { weightKg?: number | null; codAmount?: number | null }): FeeBreakdown {
  const baseBdt = Math.max(0, Math.round(zone.baseFeeBdt));
  const extraKg = extraKilograms(input.weightKg, zone.includedKg);
  const weightBdt = extraKg * Math.max(0, Math.round(zone.perExtraKgBdt));
  const codBdt = codFee(input.codAmount, zone.codFeePercent, Math.round(zone.codFeeMinBdt));
  return { baseBdt, extraKg, weightBdt, codBdt, totalBdt: baseBdt + weightBdt + codBdt };
}

// ── Charge planning (create / edit) ──────────────────────────

/** What is stored on the delivery. */
export interface ChargeState {
  status: string;
  deliveryAddress: string;
  weightKg: number | null;
  codAmount: number | null;
  zoneId: string | null;
  deliveryFeeBdt: number | null;
  feeOverridden: boolean;
}

/**
 * Requested changes (undefined = not sent).
 *  zoneId: a zone id = pick it manually; null = match automatically.
 *  deliveryFeeBdt: a number = override the fee; null = remove the override.
 */
export interface ChargeEdit {
  deliveryAddress?: string;
  weightKg?: number | null;
  codAmount?: number | null;
  zoneId?: string | null;
  deliveryFeeBdt?: number | null;
}

export interface ChargePlan {
  zoneId: string | null;
  deliveryFeeBdt: number | null;
  feeOverridden: boolean;
}

export class ZoneChoiceError extends Error {
  constructor(message = "Choose an active delivery zone") {
    super(message);
    this.name = "ZoneChoiceError";
  }
}

export const NEW_DELIVERY_STATE: ChargeState = {
  status: "CREATED",
  deliveryAddress: "",
  weightKg: null,
  codAmount: null,
  zoneId: null,
  deliveryFeeBdt: null,
  feeOverridden: false,
};

export function isFinalStatus(status: string): boolean {
  return (FINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * New zone / fee of a delivery after `edit`, given ALL the organization's
 * zones (inactive ones included: a delivery keeps an inactive zone's price
 * until it is re-matched). Throws ZoneChoiceError for an unknown or
 * inactive manual zone. For a new delivery pass NEW_DELIVERY_STATE.
 */
export function planCharge(current: ChargeState, edit: ChargeEdit, zones: readonly ZoneRule[]): ChargePlan {
  const final = isFinalStatus(current.status);
  const address = edit.deliveryAddress ?? current.deliveryAddress;
  const weightKg = edit.weightKg === undefined ? current.weightKg : edit.weightKg;
  const codAmount = edit.codAmount === undefined ? current.codAmount : edit.codAmount || null;

  // ── zone ──
  let zone: ZoneRule | null;
  const zoneExplicit = edit.zoneId !== undefined;
  const addressChanged = edit.deliveryAddress !== undefined && edit.deliveryAddress !== current.deliveryAddress;
  const currentZone = current.zoneId ? zones.find((z) => z.id === current.zoneId) ?? null : null;
  if (edit.zoneId) {
    if (edit.zoneId === current.zoneId && currentZone) zone = currentZone; // unchanged pick (even if since deactivated)
    else {
      zone = resolveZone(zones, address, edit.zoneId).zone;
      if (!zone) throw new ZoneChoiceError();
    }
  } else if (zoneExplicit || (addressChanged && !final)) {
    zone = matchZone(zones, address).zone;
  } else if (currentZone || final) {
    zone = currentZone;
  } else {
    // no zone yet (or it was deleted) and an open delivery is being edited: try to match one
    zone = matchZone(zones, address).zone;
  }
  const zoneId = zone?.id ?? null;

  // ── fee ──
  if (typeof edit.deliveryFeeBdt === "number") {
    return { zoneId, deliveryFeeBdt: Math.max(0, Math.round(edit.deliveryFeeBdt)), feeOverridden: true };
  }
  const overrideCleared = edit.deliveryFeeBdt === null && current.feeOverridden;
  const feeOverridden = current.feeOverridden && !overrideCleared;
  if (feeOverridden) return { zoneId, deliveryFeeBdt: current.deliveryFeeBdt, feeOverridden: true };

  const weightChanged = edit.weightKg !== undefined && (edit.weightKg ?? null) !== current.weightKg;
  const codChanged = edit.codAmount !== undefined && (edit.codAmount || null) !== current.codAmount;
  const inputsChanged = zoneId !== current.zoneId || weightChanged || codChanged || current.deliveryFeeBdt === null;
  const recalc = final ? zoneExplicit || overrideCleared : inputsChanged || overrideCleared || zoneExplicit;
  if (!recalc) return { zoneId, deliveryFeeBdt: current.deliveryFeeBdt, feeOverridden: false };
  return { zoneId, deliveryFeeBdt: zone ? calculateFee(zone, { weightKg, codAmount }).totalBdt : null, feeOverridden: false };
}

/**
 * "Recalculate open deliveries" after zone prices changed: an open,
 * non-overridden delivery keeps its zone (a manual pick stays) and gets that
 * zone's current price; one without a zone is matched now. When no zone can
 * be found the stored fee is left alone. Overridden or finished deliveries
 * are returned unchanged.
 */
export function repriceCharge(current: ChargeState, zones: readonly ZoneRule[]): ChargePlan {
  const unchanged: ChargePlan = { zoneId: current.zoneId, deliveryFeeBdt: current.deliveryFeeBdt, feeOverridden: current.feeOverridden };
  if (current.feeOverridden || isFinalStatus(current.status)) return unchanged;
  const zone = (current.zoneId ? zones.find((z) => z.id === current.zoneId) : null) ?? matchZone(zones, current.deliveryAddress).zone;
  if (!zone) return unchanged;
  return {
    zoneId: zone.id,
    deliveryFeeBdt: calculateFee(zone, { weightKg: current.weightKg, codAmount: current.codAmount }).totalBdt,
    feeOverridden: false,
  };
}

// ── Starter templates (common Bangladeshi courier pricing) ───

export interface ZoneTemplate {
  name: string;
  areas: string[];
  baseFeeBdt: number;
  includedKg: number;
  perExtraKgBdt: number;
  codFeePercent: number;
  codFeeMinBdt: number;
  isDefault: boolean;
}

const DHAKA_CITY_AREAS = [
  "Dhanmondi", "Lalmatia", "Mohammadpur", "Adabor", "Shyamoli", "Kallyanpur", "Mirpur", "Pallabi", "Kazipara", "Shewrapara",
  "Kafrul", "Agargaon", "Sher-e-Bangla Nagar", "Tejgaon", "Farmgate", "Karwan Bazar", "Kawran Bazar", "Panthapath", "Kalabagan",
  "Green Road", "Elephant Road", "Nilkhet", "Science Lab", "Hazaribagh", "Jigatola", "Rayer Bazar", "Azimpur", "Lalbagh",
  "Chawkbazar", "Old Dhaka", "Puran Dhaka", "Sadarghat", "Wari", "Sutrapur", "Gendaria", "Jatrabari", "Shyampur", "Demra",
  "Motijheel", "Paltan", "Purana Paltan", "Dilkusha", "Kakrail", "Shantinagar", "Ramna", "Shahbag", "Segunbagicha", "Mogbazar",
  "Moghbazar", "Malibagh", "Rampura", "Banasree", "Khilgaon", "Basabo", "Bashabo", "Sabujbagh", "Mugda", "Kamalapur",
  "Badda", "Merul Badda", "Aftabnagar", "Beraid", "Gulshan", "Banani", "Baridhara", "Bashundhara", "Niketan", "Mohakhali",
  "Dhaka Cantonment", "Khilkhet", "Nikunja", "Uttara", "Dakshinkhan", "Uttarkhan", "Turag", "Vatara", "Hatirjheel",
  "ধানমন্ডি", "মোহাম্মদপুর", "মিরপুর", "তেজগাঁও", "ফার্মগেট", "মতিঝিল", "পল্টন", "রামপুরা", "বাড্ডা", "গুলশান", "বনানী",
  "বসুন্ধরা", "মহাখালী", "উত্তরা", "খিলগাঁও", "যাত্রাবাড়ী", "লালবাগ", "পুরান ঢাকা",
];

const DHAKA_SUBURB_AREAS = [
  "Savar", "Ashulia", "Hemayetpur", "Dhamrai", "Keraniganj", "Jinjira", "Dohar", "Nawabganj", "Gazipur", "Tongi",
  "Board Bazar", "Joydebpur", "Narayanganj", "Fatullah", "Siddhirganj", "Kanchpur", "Rupganj", "Purbachal",
  "সাভার", "আশুলিয়া", "কেরানীগঞ্জ", "গাজীপুর", "টঙ্গী", "নারায়ণগঞ্জ", "ফতুল্লা",
];

/** "Inside Dhaka 60৳ / Dhaka suburbs 100৳ / Outside Dhaka 120৳" — a common courier price list. */
export const STARTER_ZONES: readonly ZoneTemplate[] = [
  { name: "Inside Dhaka", areas: DHAKA_CITY_AREAS, baseFeeBdt: 60, includedKg: 1, perExtraKgBdt: 15, codFeePercent: 1, codFeeMinBdt: 0, isDefault: false },
  { name: "Dhaka suburbs", areas: DHAKA_SUBURB_AREAS, baseFeeBdt: 100, includedKg: 1, perExtraKgBdt: 20, codFeePercent: 1, codFeeMinBdt: 0, isDefault: false },
  { name: "Outside Dhaka", areas: [], baseFeeBdt: 120, includedKg: 1, perExtraKgBdt: 20, codFeePercent: 1, codFeeMinBdt: 10, isDefault: true },
];

/** Trimmed, de-duplicated keywords (duplicates compared in normalized form); empty ones dropped. */
export function cleanAreas(areas: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of areas) {
    const area = raw.trim().replace(/\s+/g, " ");
    const key = normalizeForMatch(area);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(area);
  }
  return out;
}

/** "1 kg included, ৳15 per extra kg" style summary of the weight rule. */
export function describeWeightRule(zone: Pick<ZoneRule, "includedKg" | "perExtraKgBdt">): string {
  if (!zone.perExtraKgBdt) return "Any weight";
  return `${zone.includedKg} kg included, ৳${zone.perExtraKgBdt.toLocaleString("en-US")}/extra kg`;
}

/** "1% (min ৳10)" style summary of the COD fee. */
export function describeCodFee(zone: Pick<ZoneRule, "codFeePercent" | "codFeeMinBdt">): string {
  if (!zone.codFeePercent && !zone.codFeeMinBdt) return "No COD fee";
  const pct = `${zone.codFeePercent}%`;
  return zone.codFeeMinBdt ? `${pct} (min ৳${zone.codFeeMinBdt.toLocaleString("en-US")})` : pct;
}
