import { describe, expect, it } from "vitest";
import type { Plan } from "@prisma/client";
import { listPrice, planHasFeature, toPlanDefinition } from "@/lib/plans";
import { startOfMonthInTz, tzOffsetMinutes, zonedTimeToUtc } from "@/lib/timezone";

describe("timezone helpers", () => {
  it("Asia/Dhaka is UTC+6", () => {
    expect(tzOffsetMinutes(new Date("2026-10-21T00:00:00Z"), "Asia/Dhaka")).toBe(360);
  });
  it("converts Dhaka wall-clock time to UTC", () => {
    expect(zonedTimeToUtc(2026, 10, 21, 9, 30, "Asia/Dhaka").toISOString()).toBe("2026-10-21T03:30:00.000Z");
  });
  it("month starts at local midnight, even when UTC is still in the previous month", () => {
    // 2026-11-01 02:00 Dhaka = 2026-10-31 20:00 UTC → month is November in Dhaka
    expect(startOfMonthInTz(new Date("2026-10-31T20:00:00Z"), "Asia/Dhaka").toISOString()).toBe("2026-10-31T18:00:00.000Z");
  });
  it("handles DST zones", () => {
    expect(zonedTimeToUtc(2026, 7, 1, 12, 0, "Europe/London").toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(zonedTimeToUtc(2026, 1, 1, 12, 0, "Europe/London").toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });
});

const row = (over: Partial<Plan> = {}): Plan => ({
  code: "growth", name: "Growth", description: null, monthlyPriceBdt: 4000, annualPriceBdt: 40000,
  maxDrivers: 20, maxVehicles: 20, maxAdmins: 3, maxMonthlyDeliveries: 3000,
  features: ["csv_import", "report_export", "customer_emails"], highlights: ["a"],
  active: true, isPublic: true, isDefault: false, sortOrder: 2,
  createdAt: new Date(), updatedAt: new Date(), ...over,
});

describe("plans (DB rows)", () => {
  it("maps a Plan row to a PlanDefinition (null limit = unlimited)", () => {
    const p = toPlanDefinition(row({ maxAdmins: null }));
    expect(p.limits).toEqual({ drivers: 20, vehicles: 20, admins: null, monthlyDeliveries: 3000 });
    expect(p).not.toHaveProperty("createdAt");
  });
  it("ignores unknown/legacy feature keys so a stale value can't grant anything", () => {
    const p = toPlanDefinition(row({ features: ["csv_import", "sms", "white_label"] }));
    expect(p.features).toEqual(["csv_import"]);
    expect(planHasFeature(p, "csv_import")).toBe(true);
    expect(planHasFeature(p, "report_export")).toBe(false);
  });
  it("list price per billing cycle", () => {
    const p = toPlanDefinition(row({ annualPriceBdt: null }));
    expect(listPrice(p, "MONTHLY")).toBe(4000);
    expect(listPrice(p, "ANNUAL")).toBeNull();
  });
});
