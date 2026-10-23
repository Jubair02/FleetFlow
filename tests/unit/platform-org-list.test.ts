import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { ApiError } from "@/lib/api-helpers";
import { isValidIsoDay, orgListQuery, parseQuery, parseRegisteredRange } from "@/lib/platform-service";
import type { PlatformOrgRow } from "@/lib/platform-types";
import {
  exportFilename, formatTrend, ORG_CSV_HEADER, orgCsvRows, orgInitials, orgShortId, pageNumbers, paletteIndex, showingRange,
  statusFilterParams, subscriptionLine, toIsoDay, trendPercent,
} from "@/components/platform/organizations/org-list-utils";

function statusOf(fn: () => unknown): number | "ok" {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof ApiError) return e.status;
    throw e;
  }
}

const KEYS = ["search", "status", "plan", "page", "pageSize", "subscription", "from", "to", "export"];
const p = (qs: string) => new URLSearchParams(qs);

describe("trendPercent / formatTrend", () => {
  it("is the rounded % change vs the previous period", () => {
    expect(trendPercent(12, 10)).toBe(20);
    expect(trendPercent(5, 10)).toBe(-50);
    expect(trendPercent(10, 10)).toBe(0);
    expect(trendPercent(1, 3)).toBe(-67);
    expect(trendPercent(0, 4)).toBe(-100);
  });
  it("is null without a baseline (previous 0) instead of an infinite %", () => {
    expect(trendPercent(7, 0)).toBeNull();
    expect(trendPercent(0, 0)).toBeNull();
    expect(trendPercent(Number.NaN, 3)).toBeNull();
  });
  it("formats with a sign", () => {
    expect(formatTrend(20)).toBe("+20%");
    expect(formatTrend(-8)).toBe("−8%");
    expect(formatTrend(0)).toBe("0%");
  });
});

describe("registered date range (?from=&to=)", () => {
  it("validates real calendar days", () => {
    expect(isValidIsoDay("2026-02-28")).toBe(true);
    expect(isValidIsoDay("2024-02-29")).toBe(true);
    expect(isValidIsoDay("2026-02-30")).toBe(false);
    expect(isValidIsoDay("2026-2-3")).toBe(false);
    expect(isValidIsoDay("yesterday")).toBe(false);
  });
  it("maps to an inclusive UTC day range { gte, lt }", () => {
    expect(parseRegisteredRange()).toBeNull();
    expect(parseRegisteredRange("2026-10-01", "2026-10-22")).toEqual({
      gte: new Date("2026-10-01T00:00:00.000Z"),
      lt: new Date("2026-10-23T00:00:00.000Z"),
    });
    expect(parseRegisteredRange("2026-12-31", undefined)).toEqual({ gte: new Date("2026-12-31T00:00:00.000Z") });
    expect(parseRegisteredRange(undefined, "2026-12-31")).toEqual({ lt: new Date("2027-01-01T00:00:00.000Z") });
    expect(parseRegisteredRange("2026-10-05", "2026-10-05")).toEqual({
      gte: new Date("2026-10-05T00:00:00.000Z"),
      lt: new Date("2026-10-06T00:00:00.000Z"),
    });
  });
  it("rejects from after to, and invalid days, with 400", () => {
    expect(statusOf(() => parseRegisteredRange("2026-10-22", "2026-10-01"))).toBe(400);
    expect(statusOf(() => parseRegisteredRange("2026-13-01"))).toBe(400);
  });
});

describe("orgListQuery (additive params)", () => {
  it("keeps the old shape when only old params are given", () => {
    expect(parseQuery(orgListQuery, p("status=all&search=&page="), ["search", "status", "plan", "page"])).toEqual({ page: 1 });
    expect(parseQuery(orgListQuery, p(""), KEYS)).toEqual({ page: 1 });
  });
  it("parses pageSize, subscription, from/to and export", () => {
    expect(parseQuery(orgListQuery, p("pageSize=50&subscription=PAST_DUE&from=2026-01-01&to=2026-02-01&export=1"), KEYS)).toEqual({
      page: 1, pageSize: 50, subscription: "PAST_DUE", from: "2026-01-01", to: "2026-02-01", export: "1",
    });
  });
  it("rejects bad values with 400", () => {
    for (const qs of ["pageSize=15", "pageSize=abc", "subscription=EXPIRED", "from=2026-02-30", "to=22/10/2026", "export=yes"]) {
      expect(statusOf(() => parseQuery(orgListQuery, p(qs), KEYS)), qs).toBe(400);
    }
  });
});

describe("status filter mapping", () => {
  it("splits account status from subscription status", () => {
    expect(statusFilterParams("all")).toEqual({ status: null, subscription: null });
    expect(statusFilterParams("org:SUSPENDED")).toEqual({ status: "SUSPENDED", subscription: null });
    expect(statusFilterParams("sub:TRIAL")).toEqual({ status: null, subscription: "TRIAL" });
    expect(statusFilterParams("sub:PAST_DUE")).toEqual({ status: null, subscription: "PAST_DUE" });
  });
});

describe("pagination helpers", () => {
  it("shows every page when there are few", () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(2, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageNumbers(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it("uses ellipses with a constant number of slots", () => {
    expect(pageNumbers(1, 12)).toEqual([1, 2, 3, 4, 5, "ellipsis", 12]);
    expect(pageNumbers(6, 12)).toEqual([1, "ellipsis", 5, 6, 7, "ellipsis", 12]);
    expect(pageNumbers(12, 12)).toEqual([1, "ellipsis", 8, 9, 10, 11, 12]);
    expect(pageNumbers(99, 12)).toEqual([1, "ellipsis", 8, 9, 10, 11, 12]);
  });
  it("computes the 'Showing x–y of n' range", () => {
    expect(showingRange(1, 10, 12)).toEqual({ from: 1, to: 10 });
    expect(showingRange(2, 10, 12)).toEqual({ from: 11, to: 12 });
    expect(showingRange(1, 20, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe("identity helpers", () => {
  it("short id uses the random tail of the id", () => {
    expect(orgShortId("cmg3x2abc0001q8w7e6r")).toBe("ORG-8W7E6R");
    expect(orgShortId("abc")).toBe("ORG-ABC");
  });
  it("initials and colour index are deterministic", () => {
    expect(orgInitials("Meghna Foods Ltd")).toBe("MF");
    expect(orgInitials("  acme ")).toBe("A");
    expect(orgInitials("& Co")).toBe("C");
    expect(orgInitials("")).toBe("?");
    expect(paletteIndex("org_1", 6)).toBe(paletteIndex("org_1", 6));
    expect(paletteIndex("org_1", 6)).toBeGreaterThanOrEqual(0);
    expect(paletteIndex("org_1", 6)).toBeLessThan(6);
  });
});

const row = (over: Partial<PlatformOrgRow> = {}): PlatformOrgRow => ({
  id: "cm0000000000abcdef",
  name: "Meghna Foods",
  status: "ACTIVE",
  plan: "growth",
  planName: "Growth",
  subscriptionStatus: "ACTIVE",
  paidUntil: "2026-11-30T00:00:00.000Z",
  billingCycle: "MONTHLY",
  subscriptionPriceBdt: 2500,
  createdAt: "2026-01-15T08:30:00.000Z",
  counts: { admins: 2, drivers: 5, vehicles: 3, deliveries: 120, deliveriesThisMonth: 14 },
  lastActivityAt: "2026-10-20T10:00:00.000Z",
  contactEmail: "ops@meghna.test",
  planActive: true,
  users: 8,
  deliveries30d: 40,
  deliveriesPrev30d: 32,
  ...over,
});

describe("subscriptionLine", () => {
  const fmt = (iso: string) => iso.slice(0, 10);
  const rel = () => "3 days ago";
  it("only states what the data supports", () => {
    expect(subscriptionLine(row(), fmt, rel)).toBe("Renews 2026-11-30");
    expect(subscriptionLine(row({ subscriptionStatus: "CANCELLED" }), fmt, rel)).toBe("Ended 2026-11-30");
    expect(subscriptionLine(row({ subscriptionStatus: "PAST_DUE" }), fmt, rel)).toBe("Was due 2026-11-30");
    expect(subscriptionLine(row({ subscriptionStatus: "TRIAL" }), fmt, rel)).toBe("Trial until 2026-11-30");
    expect(subscriptionLine(row({ subscriptionStatus: "TRIAL", paidUntil: null }), fmt, rel)).toBe("Trial started 3 days ago");
    expect(subscriptionLine(row({ paidUntil: null }), fmt, rel)).toBeNull();
  });
});

describe("CSV export rows", () => {
  it("header + one row per organization with ISO dates", () => {
    const rows = orgCsvRows([row(), row({ id: "x2", name: "=HYPERLINK()", contactEmail: null, subscriptionPriceBdt: null, status: "SUSPENDED", paidUntil: null, lastActivityAt: null })]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual([...ORG_CSV_HEADER]);
    expect(rows[0]).toHaveLength(rows[1].length);
    const h = (name: (typeof ORG_CSV_HEADER)[number]) => ORG_CSV_HEADER.indexOf(name);
    expect(rows[1][h("Name")]).toBe("Meghna Foods");
    expect(rows[1][h("Contact email")]).toBe("ops@meghna.test");
    expect(rows[1][h("Subscription")]).toBe("Active");
    expect(rows[1][h("Paid until")]).toBe("2026-11-30");
    expect(rows[1][h("Registered")]).toBe("2026-01-15");
    expect(rows[1][h("Deliveries (last 30 days)")]).toBe(40);
    expect(rows[1][h("Users")]).toBe(8);
    // Raw values — escaping/formula neutralisation is downloadCsv's job.
    expect(rows[2][h("Name")]).toBe("=HYPERLINK()");
    expect(rows[2][h("Price (BDT)")]).toBe("");
    expect(rows[2][h("Status")]).toBe("Suspended");
    expect(rows[2][h("Paid until")]).toBe("");
  });
  it("names the file by local date", () => {
    expect(exportFilename(new Date(2026, 9, 22, 23, 59))).toBe("fleetflow-organizations-2026-10-22.csv");
    expect(toIsoDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
