import { describe, expect, it } from "vitest";
import { getPlan, PLANS } from "@/lib/plans";
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

describe("plans", () => {
  it("falls back to trial for unknown or legacy codes", () => {
    expect(getPlan(null).code).toBe("trial");
    expect(getPlan("enterprise-legacy").code).toBe("trial");
    expect(getPlan("GROWTH").code).toBe("growth");
  });
  it("tiers grow monotonically", () => {
    const order = [PLANS.starter, PLANS.growth, PLANS.business];
    for (let i = 1; i < order.length; i++) {
      expect(order[i].proposedPriceBdt!).toBeGreaterThan(order[i - 1].proposedPriceBdt!);
      expect(order[i].limits.drivers!).toBeGreaterThan(order[i - 1].limits.drivers!);
    }
  });
});
