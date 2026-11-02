import { describe, expect, it } from "vitest";
import {
  areaMatches,
  calculateFee,
  cleanAreas,
  codFee,
  extraKilograms,
  matchZone,
  NEW_DELIVERY_STATE,
  normalizeForMatch,
  planCharge,
  repriceCharge,
  resolveZone,
  STARTER_ZONES,
  ZoneChoiceError,
  type ChargeState,
  type ZoneRule,
} from "@/lib/zones";
import { chargesByZone } from "@/lib/report-metrics";
import { parseFeeBdt, parseWeightKg } from "@/lib/delivery-import";
import { createStaffDeliverySchema, createZoneSchema, reorderZonesSchema, updateDeliverySchema, updateZoneSchema, zonePreviewSchema } from "@/lib/validation";

const zone = (over: Partial<ZoneRule> = {}): ZoneRule => ({
  id: "z1",
  name: "Inside Dhaka",
  areas: ["Dhanmondi", "Mirpur", "Uttara"],
  baseFeeBdt: 60,
  includedKg: 1,
  perExtraKgBdt: 15,
  codFeePercent: 1,
  codFeeMinBdt: 0,
  isDefault: false,
  sortOrder: 0,
  active: true,
  ...over,
});

const inside = zone();
const suburbs = zone({ id: "z2", name: "Dhaka suburbs", areas: ["Savar", "Gazipur", "সাভার"], baseFeeBdt: 100, perExtraKgBdt: 20, sortOrder: 1 });
const outside = zone({ id: "z3", name: "Outside Dhaka", areas: [], baseFeeBdt: 120, perExtraKgBdt: 20, codFeeMinBdt: 10, isDefault: true, sortOrder: 2 });
const ZONES = [outside, suburbs, inside];

describe("normalizeForMatch / areaMatches", () => {
  it("lower-cases, collapses punctuation and splits letters from digits", () => {
    expect(normalizeForMatch("  House 12, Road-5;  MIRPUR-10 ")).toBe("house 12 road 5 mirpur 10");
    expect(normalizeForMatch("Mirpur10")).toBe("mirpur 10");
    expect(normalizeForMatch("মিরপুর-১০")).toBe("মিরপুর 10");
  });

  it("matches whole words only", () => {
    expect(areaMatches("Plot 4, Mirpur 10, Dhaka", "Mirpur")).toBe(true);
    expect(areaMatches("Mirpurkhas Road", "Mirpur")).toBe(false);
    expect(areaMatches("Sector 3, Mirpur-10", "Mirpur 10")).toBe(true);
    expect(areaMatches("Mirpur10 Bus Stand", "mirpur 10")).toBe(true);
    expect(areaMatches("Mirpur 1, Dhaka", "Mirpur 10")).toBe(false);
    expect(areaMatches("Sher e Bangla Nagar", "Sher-e-Bangla Nagar")).toBe(true);
    expect(areaMatches("anything", "  -- ")).toBe(false);
  });

  it("matches Bangla keywords as whole words", () => {
    expect(areaMatches("বাড়ি ১২, ধানমন্ডি, ঢাকা", "ধানমন্ডি")).toBe(true);
    expect(areaMatches("সাভার বাজার", "সাভার")).toBe(true);
    expect(areaMatches("মিরপুরে", "মিরপুর")).toBe(false);
  });
});

describe("matchZone", () => {
  it("picks the first active zone by sortOrder whose area appears", () => {
    const m = matchZone(ZONES, "House 5, Road 2, Dhanmondi, Dhaka");
    expect(m).toMatchObject({ kind: "area", matchedArea: "Dhanmondi" });
    expect(m.zone?.id).toBe("z1");
    // both match → the lower sortOrder wins
    const both = [zone({ id: "a", sortOrder: 5, areas: ["Savar"] }), zone({ id: "b", sortOrder: 1, areas: ["Savar"] })];
    expect(matchZone(both, "Savar").zone?.id).toBe("b");
    // equal sortOrder → by name
    const named = [zone({ id: "x", name: "Zeta", sortOrder: 0, areas: ["Savar"] }), zone({ id: "y", name: "Alpha", sortOrder: 0, areas: ["Savar"] })];
    expect(matchZone(named, "Savar").zone?.id).toBe("y");
  });

  it("falls back to the active default zone, else none", () => {
    expect(matchZone(ZONES, "Shop 41, New Market, Chattogram")).toMatchObject({ kind: "default", matchedArea: null });
    expect(matchZone(ZONES, "Chattogram").zone?.id).toBe("z3");
    expect(matchZone(ZONES, "").zone?.id).toBe("z3");
    expect(matchZone([inside], "Chattogram")).toEqual({ zone: null, kind: "none", matchedArea: null });
    expect(matchZone([], "Dhanmondi")).toEqual({ zone: null, kind: "none", matchedArea: null });
  });

  it("ignores inactive zones, including an inactive default", () => {
    expect(matchZone([zone({ active: false }), suburbs], "Dhanmondi").zone).toBeNull();
    expect(matchZone([zone({ ...outside, active: false })], "Sylhet").zone).toBeNull();
  });

  it("resolveZone honours a manual pick and rejects inactive/unknown ones", () => {
    expect(resolveZone(ZONES, "Dhanmondi", "z3")).toMatchObject({ kind: "manual" });
    expect(resolveZone(ZONES, "Dhanmondi", "z3").zone?.id).toBe("z3");
    expect(resolveZone(ZONES, "Dhanmondi", "nope").zone).toBeNull();
    expect(resolveZone([zone({ active: false })], "x", "z1").zone).toBeNull();
  });
});

describe("calculateFee", () => {
  it("charges each started kg above the included weight", () => {
    expect(extraKilograms(null, 1)).toBe(0);
    expect(extraKilograms(1, 1)).toBe(0);
    expect(extraKilograms(1.01, 1)).toBe(1);
    expect(extraKilograms(2, 1)).toBe(1);
    expect(extraKilograms(2.3, 1)).toBe(2);
    expect(extraKilograms(1.3, 0.3)).toBe(1); // float noise (1.0000000000000002) is not an extra kg
    expect(extraKilograms(0.5, 0)).toBe(1);
  });

  it("COD fee is a percentage with a minimum, only for COD orders", () => {
    expect(codFee(null, 1, 10)).toBe(0);
    expect(codFee(0, 1, 10)).toBe(0);
    expect(codFee(500, 1, 10)).toBe(10);
    expect(codFee(1250, 1, 0)).toBe(13); // 12.5 rounds up
    expect(codFee(5000, 1.5, 10)).toBe(75);
  });

  it("adds base + weight + COD into a breakdown", () => {
    expect(calculateFee(inside, { weightKg: 2.3, codAmount: 1250 })).toEqual({ baseBdt: 60, extraKg: 2, weightBdt: 30, codBdt: 13, totalBdt: 103 });
    expect(calculateFee(outside, { weightKg: null, codAmount: 300 })).toEqual({ baseBdt: 120, extraKg: 0, weightBdt: 0, codBdt: 10, totalBdt: 130 });
    expect(calculateFee(inside, {}).totalBdt).toBe(60);
  });
});

const state = (over: Partial<ChargeState> = {}): ChargeState => ({
  status: "CREATED",
  deliveryAddress: "House 5, Dhanmondi",
  weightKg: null,
  codAmount: null,
  zoneId: "z1",
  deliveryFeeBdt: 60,
  feeOverridden: false,
  ...over,
});

describe("planCharge", () => {
  it("prices a new delivery from the matched zone", () => {
    expect(planCharge(NEW_DELIVERY_STATE, { deliveryAddress: "Road 2, Mirpur-10", weightKg: 3, codAmount: 1000 }, ZONES)).toEqual({
      zoneId: "z1",
      deliveryFeeBdt: 60 + 30 + 10,
      feeOverridden: false,
    });
    expect(planCharge(NEW_DELIVERY_STATE, { deliveryAddress: "Sylhet" }, ZONES)).toEqual({ zoneId: "z3", deliveryFeeBdt: 120, feeOverridden: false });
    expect(planCharge(NEW_DELIVERY_STATE, { deliveryAddress: "Sylhet" }, [])).toEqual({ zoneId: null, deliveryFeeBdt: null, feeOverridden: false });
  });

  it("uses a manual zone and a typed fee", () => {
    expect(planCharge(NEW_DELIVERY_STATE, { deliveryAddress: "Dhanmondi", zoneId: "z2" }, ZONES)).toMatchObject({ zoneId: "z2", deliveryFeeBdt: 100 });
    expect(planCharge(NEW_DELIVERY_STATE, { deliveryAddress: "Dhanmondi", deliveryFeeBdt: 45 }, ZONES)).toEqual({ zoneId: "z1", deliveryFeeBdt: 45, feeOverridden: true });
    expect(() => planCharge(NEW_DELIVERY_STATE, { deliveryAddress: "x", zoneId: "missing" }, ZONES)).toThrow(ZoneChoiceError);
    expect(() => planCharge(NEW_DELIVERY_STATE, { deliveryAddress: "x", zoneId: "z1" }, [zone({ active: false })])).toThrow(ZoneChoiceError);
  });

  it("re-matches and re-prices when the address changes", () => {
    expect(planCharge(state(), { deliveryAddress: "Savar Bazar" }, ZONES)).toEqual({ zoneId: "z2", deliveryFeeBdt: 100, feeOverridden: false });
  });

  it("re-prices on weight / COD changes but keeps the zone", () => {
    expect(planCharge(state({ zoneId: "z2", deliveryFeeBdt: 100 }), { weightKg: 2 }, ZONES)).toEqual({ zoneId: "z2", deliveryFeeBdt: 120, feeOverridden: false });
    expect(planCharge(state(), { codAmount: 2000 }, ZONES).deliveryFeeBdt).toBe(80);
    // unchanged inputs → stored fee kept even if the zone price changed since
    expect(planCharge(state({ deliveryFeeBdt: 50 }), { weightKg: null, deliveryAddress: "House 5, Dhanmondi" }, ZONES).deliveryFeeBdt).toBe(50);
  });

  it("never recalculates an overridden fee until the override is cleared", () => {
    const over = state({ deliveryFeeBdt: 45, feeOverridden: true });
    expect(planCharge(over, { weightKg: 5, deliveryAddress: "Savar" }, ZONES)).toEqual({ zoneId: "z2", deliveryFeeBdt: 45, feeOverridden: true });
    expect(planCharge(over, { deliveryFeeBdt: null }, ZONES)).toEqual({ zoneId: "z1", deliveryFeeBdt: 60, feeOverridden: false });
    expect(planCharge(state(), { deliveryFeeBdt: null }, ZONES)).toEqual({ zoneId: "z1", deliveryFeeBdt: 60, feeOverridden: false });
  });

  it("keeps a finished delivery's zone and fee unless the zone/fee are edited explicitly", () => {
    const failed = state({ status: "FAILED", deliveryFeeBdt: 50 });
    expect(planCharge(failed, { deliveryAddress: "Savar", weightKg: 4, codAmount: 900 }, ZONES)).toEqual({ zoneId: "z1", deliveryFeeBdt: 50, feeOverridden: false });
    expect(planCharge(failed, { zoneId: "z3" }, ZONES)).toEqual({ zoneId: "z3", deliveryFeeBdt: 120, feeOverridden: false });
    expect(planCharge(failed, { deliveryFeeBdt: 0 }, ZONES)).toEqual({ zoneId: "z1", deliveryFeeBdt: 0, feeOverridden: true });
  });

  it("keeps a manual zone that was since turned off, and matches when the zone was deleted", () => {
    const off = [zone({ active: false }), outside];
    expect(planCharge(state(), { weightKg: 2, zoneId: "z1" }, off)).toEqual({ zoneId: "z1", deliveryFeeBdt: 75, feeOverridden: false });
    expect(planCharge(state({ zoneId: null, deliveryFeeBdt: 60 }), { weightKg: 2 }, [outside])).toEqual({ zoneId: "z3", deliveryFeeBdt: 140, feeOverridden: false });
  });
});

describe("repriceCharge", () => {
  it("applies the current price of the delivery's zone, matching one if it has none", () => {
    expect(repriceCharge(state({ deliveryFeeBdt: 50 }), ZONES)).toEqual({ zoneId: "z1", deliveryFeeBdt: 60, feeOverridden: false });
    expect(repriceCharge(state({ zoneId: null, deliveryFeeBdt: null, deliveryAddress: "Savar" }), ZONES)).toMatchObject({ zoneId: "z2", deliveryFeeBdt: 100 });
  });

  it("leaves overridden, finished and unmatchable deliveries alone", () => {
    const keep = (s: ChargeState) => ({ zoneId: s.zoneId, deliveryFeeBdt: s.deliveryFeeBdt, feeOverridden: s.feeOverridden });
    for (const s of [state({ feeOverridden: true, deliveryFeeBdt: 1 }), state({ status: "DELIVERED", deliveryFeeBdt: 1 }), state({ zoneId: null, deliveryFeeBdt: 70, deliveryAddress: "Sylhet" })]) {
      expect(repriceCharge(s, [inside])).toEqual(keep(s));
    }
  });
});

describe("starter zones and area lists", () => {
  it("has one default (Outside Dhaka) and keyword lists without duplicates", () => {
    expect(STARTER_ZONES.filter((z) => z.isDefault).map((z) => z.name)).toEqual(["Outside Dhaka"]);
    for (const z of STARTER_ZONES) expect(cleanAreas(z.areas)).toHaveLength(z.areas.length);
    const starter = STARTER_ZONES.map((z, i) => ({ ...z, id: `s${i}`, sortOrder: i, active: true }));
    expect(matchZone(starter, "House 7, Road 3, Dhanmondi, Dhaka 1205").zone?.name).toBe("Inside Dhaka");
    expect(matchZone(starter, "Bank Colony, Savar, Dhaka").zone?.name).toBe("Dhaka suburbs");
    expect(matchZone(starter, "উত্তরা সেক্টর ৭").zone?.name).toBe("Inside Dhaka");
    expect(matchZone(starter, "Zindabazar, Sylhet").zone?.name).toBe("Outside Dhaka");
  });

  it("cleanAreas trims, collapses spaces and drops normalized duplicates and blanks", () => {
    expect(cleanAreas([" Mirpur  10 ", "mirpur-10", "Dhanmondi", "--", "DHANMONDI"])).toEqual(["Mirpur 10", "Dhanmondi"]);
  });
});

describe("validation", () => {
  it("createZoneSchema applies defaults and cleans areas", () => {
    const r = createZoneSchema.parse({ name: " Inside Dhaka ", baseFeeBdt: "60", areas: ["Mirpur", "mirpur"] });
    expect(r).toEqual({ name: "Inside Dhaka", baseFeeBdt: 60, areas: ["Mirpur"], includedKg: 1, perExtraKgBdt: 0, codFeePercent: 0, codFeeMinBdt: 0, isDefault: false, active: true });
  });

  it("rejects bad zone input with a readable message", () => {
    expect(createZoneSchema.safeParse({ name: "X", baseFeeBdt: 60 }).error?.issues[0].message).toMatch(/at least 2/);
    expect(createZoneSchema.safeParse({ name: "Zone", baseFeeBdt: 60.5 }).error?.issues[0].message).toMatch(/whole taka/);
    expect(createZoneSchema.safeParse({ name: "Zone", baseFeeBdt: -1 }).success).toBe(false);
    expect(createZoneSchema.safeParse({ name: "Zone", baseFeeBdt: 60, codFeePercent: 101 }).success).toBe(false);
    expect(createZoneSchema.safeParse({ name: "Zone" }).success).toBe(false);
  });

  it("updateZoneSchema doesn't inject defaults", () => {
    expect(updateZoneSchema.parse({ active: false })).toEqual({ active: false });
  });

  it("reorder and preview schemas", () => {
    expect(reorderZonesSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(zonePreviewSchema.parse({})).toEqual({ address: "" });
    expect(zonePreviewSchema.safeParse({ address: "x", weightKg: 0 }).success).toBe(false);
    expect(zonePreviewSchema.parse({ address: "Mirpur", weightKg: "1.5", codAmount: 500 })).toMatchObject({ weightKg: 1.5, codAmount: 500 });
  });

  it("delivery schemas accept weight, zone and fee override", () => {
    const base = { recipientName: "Rahim", recipientPhone: "01711000000", pickupAddress: "Tejgaon, Dhaka", deliveryAddress: "Dhanmondi, Dhaka" };
    expect(createStaffDeliverySchema.parse({ ...base, weightKg: 2.5, zoneId: "z1", deliveryFeeBdt: 80 })).toMatchObject({ weightKg: 2.5, zoneId: "z1", deliveryFeeBdt: 80 });
    expect(createStaffDeliverySchema.safeParse({ ...base, weightKg: 1001 }).success).toBe(false);
    expect(createStaffDeliverySchema.safeParse({ ...base, deliveryFeeBdt: 12.5 }).success).toBe(false);
    expect(updateDeliverySchema.parse({ zoneId: null, deliveryFeeBdt: null })).toEqual({ zoneId: null, deliveryFeeBdt: null });
  });
});

describe("import cells", () => {
  it("parses weight_kg", () => {
    expect(parseWeightKg("")).toEqual({ ok: true, value: null });
    expect(parseWeightKg("1.5")).toEqual({ ok: true, value: 1.5 });
    expect(parseWeightKg("2 KG")).toEqual({ ok: true, value: 2 });
    expect(parseWeightKg("২.৫")).toEqual({ ok: true, value: 2.5 });
    expect(parseWeightKg("0").ok).toBe(false);
    expect(parseWeightKg("heavy").ok).toBe(false);
    expect(parseWeightKg("1001").ok).toBe(false);
  });

  it("parses delivery_fee", () => {
    expect(parseFeeBdt("")).toEqual({ ok: true, value: null });
    expect(parseFeeBdt("৳150")).toEqual({ ok: true, value: 150 });
    expect(parseFeeBdt("Tk 1,200")).toEqual({ ok: true, value: 1200 });
    expect(parseFeeBdt("120 BDT")).toEqual({ ok: true, value: 120 });
    expect(parseFeeBdt("12.5").ok).toBe(false);
  });
});

describe("chargesByZone (reports)", () => {
  it("sums non-cancelled charges per zone and delivered charges, no-zone last", () => {
    const out = chargesByZone([
      { zoneId: "z1", status: "DELIVERED", count: 3, feeSum: 180 },
      { zoneId: "z1", status: "CANCELLED", count: 1, feeSum: 60 },
      { zoneId: "z2", status: "CREATED", count: 2, feeSum: 200 },
      { zoneId: null, status: "DELIVERED", count: 1, feeSum: null },
      { zoneId: "z2", status: "FAILED", count: 1, feeSum: 100 },
    ]);
    expect(out.totalChargesBdt).toBe(480);
    expect(out.deliveredChargesBdt).toBe(180);
    expect(out.byZone).toEqual([
      { zoneId: "z2", deliveries: 3, delivered: 0, chargesBdt: 300, deliveredChargesBdt: 0 },
      { zoneId: "z1", deliveries: 4, delivered: 3, chargesBdt: 180, deliveredChargesBdt: 180 },
      { zoneId: null, deliveries: 1, delivered: 1, chargesBdt: 0, deliveredChargesBdt: 0 },
    ]);
  });
});
