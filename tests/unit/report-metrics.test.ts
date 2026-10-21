import { describe, expect, it } from "vitest";
import {
  classifyTimeliness,
  driverPerformance,
  durationStats,
  failureRate,
  failureReasonCounts,
  median,
  onTimeRateFromCounts,
  onTimeStats,
  percent,
  roadTimeSpans,
  successRate,
  summarizeStatuses,
  type DriverAssignmentRow,
} from "@/lib/report-metrics";

const t = (iso: string) => new Date(iso);
const H = (h: number) => new Date(Date.UTC(2026, 9, 1) + h * 36e5);

describe("percent / rates", () => {
  it("returns null for a zero denominator instead of 0% or 100%", () => {
    expect(percent(0, 0)).toBeNull();
    expect(successRate(0, 0)).toBeNull();
    expect(failureRate(0, 0)).toBeNull();
  });
  it("rounds to whole percentages", () => {
    expect(percent(2, 3)).toBe(67);
    expect(percent(1, 3)).toBe(33);
  });
  it("success rate = delivered ÷ (delivered + failed); cancelled/open are not attempts", () => {
    expect(successRate(8, 2)).toBe(80);
    expect(successRate(5, 0)).toBe(100);
    expect(failureRate(8, 2)).toBe(20);
  });
});

describe("summarizeStatuses", () => {
  it("groups CREATED as pending dispatch and ASSIGNED/PICKED_UP/IN_TRANSIT as in progress", () => {
    const s = summarizeStatuses([
      { status: "CREATED", count: 3 },
      { status: "ASSIGNED", count: 2 },
      { status: "PICKED_UP", count: 1 },
      { status: "IN_TRANSIT", count: 4 },
      { status: "DELIVERED", count: 10 },
      { status: "FAILED", count: 2 },
      { status: "CANCELLED", count: 1 },
    ]);
    expect(s).toEqual({ total: 23, delivered: 10, failed: 2, cancelled: 1, pendingDispatch: 3, inProgress: 7 });
  });
  it("handles an empty range", () => {
    expect(summarizeStatuses([])).toEqual({ total: 0, delivered: 0, failed: 0, cancelled: 0, pendingDispatch: 0, inProgress: 0 });
  });
});

describe("timeliness", () => {
  it("delivered exactly at the deadline is on time", () => {
    expect(classifyTimeliness({ expectedAt: t("2026-10-01T10:00:00Z"), completedAt: t("2026-10-01T10:00:00Z") })).toBe("ON_TIME");
  });
  it("one millisecond after the deadline is late", () => {
    expect(classifyTimeliness({ expectedAt: t("2026-10-01T10:00:00.000Z"), completedAt: t("2026-10-01T10:00:00.001Z") })).toBe("LATE");
  });
  it("a missing deadline is never on time", () => {
    expect(classifyTimeliness({ expectedAt: null, completedAt: t("2026-10-01T10:00:00Z") })).toBe("NO_DEADLINE");
    expect(classifyTimeliness({ expectedAt: undefined, completedAt: undefined })).toBe("NO_DEADLINE");
  });
  it("a missing completion time is never on time", () => {
    expect(classifyTimeliness({ expectedAt: t("2026-10-01T10:00:00Z"), completedAt: null })).toBe("NO_COMPLETION_TIME");
  });
});

describe("onTimeStats", () => {
  it("excludes deliveries without a deadline from the denominator (the old completed − late bug)", () => {
    const rows = [
      { expectedAt: H(10), completedAt: H(9) }, // on time
      { expectedAt: H(10), completedAt: H(11) }, // late
      { expectedAt: null, completedAt: H(5) }, // no deadline
      { expectedAt: null, completedAt: H(6) }, // no deadline
    ];
    const s = onTimeStats(rows);
    expect(s).toEqual({ onTime: 1, late: 1, withDeadline: 2, withoutDeadline: 2, missingCompletion: 0, rate: 50 });
    // Old formula would have said (4 − 1) / 4 = 75%.
    expect(s.rate).not.toBe(75);
  });
  it("is null (not 100%) when no delivered job has a deadline", () => {
    const s = onTimeStats([{ expectedAt: null, completedAt: H(1) }]);
    expect(s.rate).toBeNull();
    expect(s.withoutDeadline).toBe(1);
  });
  it("is null for no deliveries", () => {
    expect(onTimeStats([]).rate).toBeNull();
  });
  it("counts a deadline with no completion time as excluded, not on time", () => {
    const s = onTimeStats([
      { expectedAt: H(10), completedAt: null },
      { expectedAt: H(10), completedAt: H(12) },
    ]);
    expect(s).toMatchObject({ onTime: 0, late: 1, withDeadline: 1, missingCompletion: 1, rate: 0 });
  });
  it("count-based variant matches the row-based rule", () => {
    expect(onTimeRateFromCounts(1, 2)).toBe(50);
    expect(onTimeRateFromCounts(0, 0)).toBeNull();
    expect(onTimeRateFromCounts(3, 3)).toBe(0);
  });
});

describe("durations", () => {
  it("median of odd and even lists", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it("mean and median in hours to one decimal, excluding missing timestamps", () => {
    const s = durationStats([
      { start: H(0), end: H(1) },
      { start: H(0), end: H(2) },
      { start: H(0), end: H(6.25) },
      { start: null, end: H(3) },
      { start: H(0), end: null },
    ]);
    expect(s.count).toBe(3);
    expect(s.excluded).toBe(2);
    expect(s.meanHours).toBe(3.1); // (1 + 2 + 6.25) / 3 = 3.083…
    expect(s.medianHours).toBe(2);
  });
  it("excludes end-before-start rows (bad data) instead of averaging negatives", () => {
    const s = durationStats([{ start: H(5), end: H(1) }]);
    expect(s).toEqual({ count: 0, excluded: 1, meanHours: null, medianHours: null });
  });
  it("road time uses the delivering assignment, falling back to the delivery's completion", () => {
    const spans = roadTimeSpans([
      { completedAt: H(5), assignments: [{ assignedAt: H(2), completedAt: H(4) }] },
      { completedAt: H(5), assignments: [{ assignedAt: H(2), completedAt: null }] },
      { completedAt: H(5), assignments: [] },
    ]);
    const s = durationStats(spans);
    expect(s.count).toBe(2);
    expect(s.excluded).toBe(1);
    expect(s.meanHours).toBe(2.5); // (2 + 3) / 2
  });
});

describe("failureReasonCounts", () => {
  it("merges counts, maps null to UNKNOWN and sorts largest first", () => {
    expect(
      failureReasonCounts([
        { failureReason: "WRONG_ADDRESS", count: 1 },
        { failureReason: null, count: 2 },
        { failureReason: "RECIPIENT_UNAVAILABLE", count: 3 },
        { failureReason: "WRONG_ADDRESS" },
      ])
    ).toEqual([
      { reason: "RECIPIENT_UNAVAILABLE", count: 3 },
      { reason: "UNKNOWN", count: 2 },
      { reason: "WRONG_ADDRESS", count: 2 },
    ]);
  });
});

describe("driverPerformance", () => {
  const row = (p: Partial<DriverAssignmentRow> & Pick<DriverAssignmentRow, "driverId" | "deliveryId">): DriverAssignmentRow => ({
    outcome: null,
    assignedAt: H(0),
    completedAt: null,
    delivery: { expectedAt: null, completedAt: null },
    ...p,
  });

  it("attributes outcomes per driver and counts distinct assigned deliveries", () => {
    const rows: DriverAssignmentRow[] = [
      // Driver A: failed d1 twice (re-dispatched to them), then delivered d1 late; delivered d2 on time; d3 no deadline.
      row({ driverId: "A", deliveryId: "d1", outcome: "FAILED" }),
      row({ driverId: "A", deliveryId: "d1", outcome: "FAILED" }),
      row({
        driverId: "A",
        deliveryId: "d1",
        outcome: "DELIVERED",
        assignedAt: H(10),
        completedAt: H(14),
        delivery: { expectedAt: H(12), completedAt: H(14) },
      }),
      row({
        driverId: "A",
        deliveryId: "d2",
        outcome: "DELIVERED",
        assignedAt: H(0),
        completedAt: H(2),
        delivery: { expectedAt: H(3), completedAt: H(2) },
      }),
      row({
        driverId: "A",
        deliveryId: "d3",
        outcome: "DELIVERED",
        assignedAt: null, // missing timestamp → excluded from road time
        delivery: { expectedAt: null, completedAt: H(8) },
      }),
      // Driver B: unassigned from d4, and an active job — no resolved attempts.
      row({ driverId: "B", deliveryId: "d4", outcome: "UNASSIGNED" }),
      row({ driverId: "B", deliveryId: "d5", outcome: null }),
    ];
    const byId = Object.fromEntries(driverPerformance(rows).map((r) => [r.driverId, r]));

    expect(byId.A).toEqual({
      driverId: "A",
      assigned: 3,
      delivered: 3,
      failed: 2,
      failureRate: 40, // 2 ÷ (3 + 2)
      onTime: 1,
      late: 1,
      deliveredWithoutDeadline: 1,
      onTimeRate: 50, // d3 (no deadline) excluded
      avgRoadHours: 3, // (4 + 2) / 2
      roadTimeExcluded: 1,
    });
    expect(byId.B).toMatchObject({ assigned: 2, delivered: 0, failed: 0, failureRate: null, onTimeRate: null, avgRoadHours: null });
  });

  it("a driver whose deliveries all lack deadlines has no on-time rate", () => {
    const [r] = driverPerformance([
      row({ driverId: "C", deliveryId: "d1", outcome: "DELIVERED", completedAt: H(1), delivery: { expectedAt: null, completedAt: H(1) } }),
    ]);
    expect(r.onTimeRate).toBeNull();
    expect(r.deliveredWithoutDeadline).toBe(1);
  });
});
