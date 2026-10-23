import { describe, expect, it } from "vitest";
import { DAY_MS, deadlinePassesAt, isDateOnlyInTz, isPastDeadline, summarizeDeadlines } from "@/lib/dashboard-metrics";
import { attentionItems, codesSummary, statusSegments, sumDaily, topDrivers } from "@/components/fleetflow/dashboard/model";
import type { DashboardData } from "@/lib/types";

// Dhaka is UTC+6 → getTimezoneOffset() = -360.
const DHAKA = -360;
const at = (iso: string) => new Date(iso);

describe("date-only deadlines in the viewer's timezone", () => {
  it("detects local midnight", () => {
    expect(isDateOnlyInTz(at("2026-10-21T18:00:00.000Z"), DHAKA)).toBe(true); // 22 Oct 00:00 Dhaka
    expect(isDateOnlyInTz(at("2026-10-22T00:00:00.000Z"), DHAKA)).toBe(false); // 06:00 Dhaka
    expect(isDateOnlyInTz(at("2026-10-22T00:00:00.000Z"), 0)).toBe(true);
  });

  it("a date-only deadline lasts the whole local day", () => {
    const due = at("2026-10-21T18:00:00.000Z"); // 22 Oct (date only, Dhaka)
    expect(deadlinePassesAt(due, DHAKA)).toBe(due.getTime() + DAY_MS);
    expect(isPastDeadline(due, at("2026-10-22T17:59:00.000Z").getTime(), DHAKA)).toBe(false); // 23:59 on the 22nd
    expect(isPastDeadline(due, at("2026-10-22T18:01:00.000Z").getTime(), DHAKA)).toBe(true); // 00:01 on the 23rd
  });

  it("a timed deadline passes at its instant", () => {
    const due = at("2026-10-22T05:00:00.000Z"); // 11:00 Dhaka
    expect(isPastDeadline(due, at("2026-10-22T05:00:01.000Z").getTime(), DHAKA)).toBe(true);
    expect(isPastDeadline(due, at("2026-10-22T04:59:00.000Z").getTime(), DHAKA)).toBe(false);
  });
});

describe("summarizeDeadlines", () => {
  const todayStart = at("2026-10-21T18:00:00.000Z").getTime(); // 22 Oct 00:00 Dhaka
  const now = at("2026-10-22T08:00:00.000Z").getTime(); // 14:00 Dhaka

  it("splits overdue (most overdue first) from still-due-today", () => {
    const rows = [
      { id: "a", expectedAt: at("2026-10-22T05:00:00.000Z") }, // today 11:00 → overdue
      { id: "b", expectedAt: at("2026-10-21T18:00:00.000Z") }, // today, date only → due today
      { id: "c", expectedAt: at("2026-10-20T18:00:00.000Z") }, // yesterday, date only → overdue
      { id: "d", expectedAt: at("2026-10-22T12:00:00.000Z") }, // today 18:00 → due today
      { id: "e", expectedAt: null },
    ];
    const r = summarizeDeadlines(rows, now, DHAKA, todayStart);
    expect(r.overdue.map((o) => o.id)).toEqual(["c", "a"]);
    expect(r.dueToday).toBe(2);
  });

  it("ignores tomorrow", () => {
    const r = summarizeDeadlines([{ expectedAt: at("2026-10-22T18:00:00.000Z") }], now, DHAKA, todayStart);
    expect(r).toEqual({ overdue: [], dueToday: 0 });
  });
});

describe("dashboard view model", () => {
  it("summarizes codes against the true count", () => {
    expect(codesSummary(["A", "B", "C"], 7)).toBe("A, B +5 more");
    expect(codesSummary(["A"], 1)).toBe("A");
    expect(codesSummary([], 3)).toBe("");
  });

  const base: DashboardData = {
    stats: {
      total: 10, pendingAssignment: 2, inProgress: 3, completed: 4, failed: 1, cancelled: 0,
      activeDrivers: 1, totalDrivers: 1, vehiclesAttention: 0, vehiclesTotal: 1, onTimeRate: null, lateCount: 0,
    },
    daily: [
      { date: "2026-10-21", total: 3, completed: 1, failed: 0 },
      { date: "2026-10-22", total: 2, completed: 2, failed: 1 },
    ],
    statusBreakdown: [
      { status: "CREATED", count: 2 }, { status: "ASSIGNED", count: 1 }, { status: "IN_TRANSIT", count: 2 },
      { status: "DELIVERED", count: 4 }, { status: "FAILED", count: 1 },
    ],
    priorityBreakdown: [],
    recentEvents: [],
    attention: {
      failedCount: 1,
      pendingUrgentCount: 0,
      failedDeliveries: [{ id: "f1", trackingCode: "FF-1", recipientName: "R", failureReason: "WRONG_ADDRESS", createdAt: "2026-10-22T00:00:00Z" }],
      pendingUrgent: [],
      maintenanceVehicles: [{ id: "v1", registrationNumber: "DHA-11", type: "VAN", status: "MAINTENANCE", notes: null }],
      overdueDeliveries: [],
    },
    driverWorkload: [],
    now: { waiting: 2, onTheRoad: 3, overdue: 0, dueToday: 1 },
  };

  it("lists only non-zero attention rows in priority order", () => {
    const items = attentionItems(base, () => "Today");
    expect(items.map((i) => i.kind)).toEqual(["failed", "vehicles"]);
    expect(items[0]).toMatchObject({ count: 1, singleDeliveryId: "f1", context: "FF-1 · Address not found or incorrect" });
    expect(items[1].context).toBe("DHA-11");
  });

  it("is empty when everything is clear", () => {
    const clear = {
      ...base,
      attention: { ...base.attention, failedCount: 0, failedDeliveries: [], maintenanceVehicles: [] },
    };
    expect(attentionItems(clear)).toEqual([]);
  });

  it("groups statuses and sums the chart window", () => {
    const s = statusSegments(base.statusBreakdown);
    expect(s.map((x) => [x.key, x.count])).toEqual([
      ["waiting", 2], ["progress", 3], ["delivered", 4], ["failed", 1], ["cancelled", 0],
    ]);
    expect(s.reduce((n, x) => n + x.share, 0)).toBeCloseTo(100);
    expect(sumDaily(base.daily)).toEqual({ created: 5, delivered: 3, failed: 1 });
  });

  it("ranks drivers available → on route → off duty → inactive and caps the list", () => {
    const w = (name: string, availability: string, active = true, activeJobs = 0) => ({
      id: name, name, availability, active, activeJobs, maxActiveJobs: 5,
    });
    const ranked = topDrivers(
      [w("Zed", "OFF_DUTY"), w("Ina", "AVAILABLE", false), w("Bo", "ON_ROUTE", true, 2), w("Al", "AVAILABLE"), w("Cy", "AVAILABLE", true, 3)],
      4,
    );
    expect(ranked.map((d) => d.name)).toEqual(["Cy", "Al", "Bo", "Zed"]);
  });
});
