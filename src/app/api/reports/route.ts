import { db } from "@/lib/db";
import { fail, localDayKey, ok, parseDateParam, parseTzOffset, requireStaff } from "@/lib/api-helpers";
import { failureReasonLabel } from "@/lib/constants";
import { assertFeature } from "@/lib/plans";
import {
  classifyTimeliness,
  driverPerformance,
  driverRatings,
  ratingStats,
  durationStats,
  failureReasonCounts,
  onTimeStats,
  roadTimeSpans,
  successRate,
  summarizeStatuses,
  chargesByZone,
} from "@/lib/report-metrics";
import type { Prisma } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAILY_DAYS = 92;
const ITEMS_CAP = 200;
const EXPORT_CAP = 10_000;
// Timing metrics and the driver breakdown load one row per delivery/assignment.
// Without a date range ("all time") that grows forever, so they use the most
// recent rows only and the response says so (metricsTruncated).
const METRIC_ROWS_CAP = 20_000;
const ASSIGNMENT_ROWS_CAP = 50_000;

type DailyRow = { date: string; total: number; completed: number; failed: number };

/** Instant of local midnight for a YYYY-MM-DD key in the viewer's timezone. */
function localDayStart(key: string, tzOffset: number): number {
  return Date.parse(`${key}T00:00:00.000Z`) + tzOffset * 60_000;
}

/** Consecutive day keys firstKey..lastKey (inclusive), keeping at most the last `max`. */
function dayKeysBetween(firstKey: string, lastKey: string, max: number): string[] {
  const keys: string[] = [];
  const first = Date.parse(`${firstKey}T00:00:00.000Z`);
  for (let t = Date.parse(`${lastKey}T00:00:00.000Z`); t >= first && keys.length < max; t -= DAY_MS) {
    keys.push(new Date(t).toISOString().slice(0, 10));
  }
  return keys.reverse();
}

// GET /api/reports?from=&to=&tz=&driverId=&vehicleId=&status=&priority=&export=1
// export=1 requires the plan feature report_export (403 otherwise).
// Delivery history with success / on-time / timing metrics + per-driver breakdown.
// `from` is inclusive, `to` exclusive (ISO instants); `tz` = viewer's getTimezoneOffset().
// Every metric is defined in src/lib/report-metrics.ts; every query below is
// scoped to the caller's organization through `where` (Delivery.organizationId).
export async function GET(req: Request) {
  try {
    const user = await requireStaff();
    const url = new URL(req.url);
    const q = (k: string) => url.searchParams.get(k)?.trim() || "";

    const from = parseDateParam(q("from"), "from");
    const to = parseDateParam(q("to"), "to");
    const tz = parseTzOffset(q("tz"));
    const driverId = q("driverId");
    const vehicleId = q("vehicleId");
    const exportAll = q("export") === "1";
    // Viewing reports is never limited; the CSV export is a plan feature.
    if (exportAll) await assertFeature(db, user.organizationId, "report_export");

    const where: Prisma.DeliveryWhereInput = { organizationId: user.organizationId };
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lt: to } : {}),
      };
    }
    // Both filters must match the same assignment.
    if (driverId || vehicleId) {
      where.assignments = {
        some: {
          ...(driverId ? { driverId } : {}),
          ...(vehicleId ? { vehicleId } : {}),
        },
      };
    }
    if (q("status")) where.status = q("status");
    if (q("priority")) where.priority = q("priority");

    // Assignments that count toward the driver breakdown (org-scoped via `delivery: where`).
    const assignmentWhere: Prisma.AssignmentWhereInput = {
      delivery: where,
      ...(driverId ? { driverId } : {}),
      ...(vehicleId ? { vehicleId } : {}),
    };

    const [statusGroups, deliveredRows, failedGroups, range, items, driverAssignments] = await Promise.all([
      db.delivery.groupBy({ by: ["status"], where, _count: { _all: true } }),
      db.delivery.findMany({
        where: { AND: [where, { status: "DELIVERED" }] },
        orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
        take: METRIC_ROWS_CAP + 1,
        select: {
          createdAt: true,
          expectedAt: true,
          completedAt: true,
          assignments: {
            where: { outcome: "DELIVERED" },
            orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { assignedAt: true, completedAt: true },
          },
        },
      }),
      db.delivery.groupBy({
        by: ["failureReason"],
        where: { AND: [where, { status: "FAILED" }] },
        _count: { _all: true },
      }),
      db.delivery.aggregate({ where, _min: { createdAt: true }, _max: { createdAt: true } }),
      db.delivery.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: exportAll ? EXPORT_CAP : ITEMS_CAP,
        include: {
          assignments: {
            orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
            include: { driver: { select: { name: true } }, vehicle: { select: { registrationNumber: true } } },
          },
          zone: { select: { name: true } },
        },
      }),
      db.assignment.findMany({
        where: assignmentWhere,
        orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
        take: ASSIGNMENT_ROWS_CAP + 1,
        select: {
          driverId: true,
          deliveryId: true,
          outcome: true,
          assignedAt: true,
          completedAt: true,
          delivery: { select: { expectedAt: true, completedAt: true } },
        },
      }),
    ]);

    const metricsTruncated = deliveredRows.length > METRIC_ROWS_CAP || driverAssignments.length > ASSIGNMENT_ROWS_CAP;
    if (deliveredRows.length > METRIC_ROWS_CAP) deliveredRows.length = METRIC_ROWS_CAP;
    if (driverAssignments.length > ASSIGNMENT_ROWS_CAP) driverAssignments.length = ASSIGNMENT_ROWS_CAP;

    // ── summary (status counts are uncapped: computed over the full filter) ──
    const counts = summarizeStatuses(statusGroups.map((g) => ({ status: g.status, count: g._count._all })));
    const onTime = onTimeStats(deliveredRows);
    const completion = durationStats(deliveredRows.map((d) => ({ start: d.createdAt, end: d.completedAt })));
    const road = durationStats(roadTimeSpans(deliveredRows));
    const failureReasons = failureReasonCounts(
      failedGroups.map((g) => ({ failureReason: g.failureReason, count: g._count._all }))
    ).map((r) => ({ ...r, label: r.reason === "UNKNOWN" ? "No reason recorded" : failureReasonLabel(r.reason) }));

    // ── customer ratings (tracking page) over the same filtered deliveries ──
    const ratedRows = await db.delivery.findMany({
      where: { AND: [where, { rating: { not: null } }] },
      orderBy: [{ ratedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      take: METRIC_ROWS_CAP,
      select: {
        rating: true,
        assignments: { where: { outcome: "DELIVERED" }, orderBy: [{ assignedAt: "desc" }, { id: "desc" }], take: 1, select: { driverId: true } },
      },
    });
    const ratings = ratingStats(ratedRows.map((r) => r.rating));
    const ratingByDriver = driverRatings(ratedRows.map((r) => ({ rating: r.rating, driverId: r.assignments[0]?.driverId ?? null })));

    // ── per-driver breakdown (from assignment outcomes) ──
    let perDriver = driverPerformance(driverAssignments);
    if (driverId) perDriver = perDriver.filter((r) => r.driverId === driverId);
    const driverNames = perDriver.length
      ? await db.user.findMany({
          where: { id: { in: perDriver.map((r) => r.driverId) }, organizationId: user.organizationId },
          select: { id: true, name: true },
        })
      : [];
    const nameMap = new Map(driverNames.map((u) => [u.id, u.name]));
    const driverBreakdown = perDriver
      .map((r) => ({
        ...r,
        driverName: nameMap.get(r.driverId) ?? "Unknown driver",
        avgRating: ratingByDriver.get(r.driverId)?.average ?? null,
        ratingCount: ratingByDriver.get(r.driverId)?.count ?? 0,
      }))
      .sort((a, b) => b.assigned - a.assigned || a.driverName.localeCompare(b.driverName));

    // ── daily series: one row per local day of the range (max 92 days, latest kept) ──
    let daily: DailyRow[] = [];
    const rangeStart = from ?? range._min.createdAt;
    const lastInstant = to ? new Date(to.getTime() - 1) : (range._max.createdAt ?? (from ? new Date() : null));
    if (rangeStart && lastInstant && rangeStart <= lastInstant) {
      const keys = dayKeysBetween(localDayKey(rangeStart, tz), localDayKey(lastInstant, tz), MAX_DAILY_DAYS);
      const windowStart = new Date(localDayStart(keys[0], tz));
      const windowEnd = new Date(localDayStart(keys[keys.length - 1], tz) + DAY_MS);
      const rows = await db.delivery.findMany({
        where: { AND: [where, { createdAt: { gte: windowStart, lt: windowEnd } }] },
        select: { createdAt: true, status: true },
      });
      const dailyMap = new Map<string, DailyRow>(keys.map((date) => [date, { date, total: 0, completed: 0, failed: 0 }]));
      for (const d of rows) {
        const cur = dailyMap.get(localDayKey(d.createdAt, tz));
        if (!cur) continue;
        cur.total++;
        if (d.status === "DELIVERED") cur.completed++;
        if (d.status === "FAILED") cur.failed++;
      }
      daily = Array.from(dailyMap.values());
    }

    // ── delivery charges by zone (SQL aggregate over the full filter — never truncated) ──
    const chargeGroups = await db.delivery.groupBy({
      by: ["zoneId", "status"],
      where,
      _count: { _all: true },
      _sum: { deliveryFeeBdt: true },
    });
    const charges = chargesByZone(
      chargeGroups.map((g) => ({ zoneId: g.zoneId, status: g.status, count: g._count._all, feeSum: g._sum.deliveryFeeBdt }))
    );
    const chargeZoneIds = charges.byZone.map((r) => r.zoneId).filter((id): id is string => !!id);
    const chargeZones = chargeZoneIds.length
      ? await db.deliveryZone.findMany({ where: { id: { in: chargeZoneIds }, organizationId: user.organizationId }, select: { id: true, name: true } })
      : [];
    const zoneNameMap = new Map(chargeZones.map((z) => [z.id, z.name]));

    return ok({
      summary: {
        total: counts.total,
        completed: counts.delivered,
        failed: counts.failed,
        cancelled: counts.cancelled,
        pendingDispatch: counts.pendingDispatch,
        inProgress: counts.inProgress,
        successRate: successRate(counts.delivered, counts.failed),
        onTimeCount: onTime.onTime,
        lateCount: onTime.late,
        onTimeRate: onTime.rate,
        deliveredWithoutDeadline: onTime.withoutDeadline + onTime.missingCompletion,
        avgCompletionHours: completion.meanHours,
        medianCompletionHours: completion.medianHours,
        completionTimeExcluded: completion.excluded,
        avgRoadHours: road.meanHours,
        medianRoadHours: road.medianHours,
        roadTimeExcluded: road.excluded,
      },
      itemsTotal: counts.total,
      metricsTruncated,
      ratings,
      driverBreakdown,
      failureReasons,
      charges: {
        totalChargesBdt: charges.totalChargesBdt,
        deliveredChargesBdt: charges.deliveredChargesBdt,
        byZone: charges.byZone.map((r) => ({ ...r, zoneName: r.zoneId ? (zoneNameMap.get(r.zoneId) ?? "Deleted zone") : "No zone" })),
      },
      daily,
      items: items.map((d) => {
        const a = d.assignments[d.assignments.length - 1];
        return {
          id: d.id,
          trackingCode: d.trackingCode,
          recipientName: d.recipientName,
          status: d.status,
          priority: d.priority,
          createdAt: d.createdAt.toISOString(),
          expectedAt: d.expectedAt?.toISOString() ?? null,
          completedAt: d.completedAt?.toISOString() ?? null,
          timeliness: d.status === "DELIVERED" ? classifyTimeliness(d) : null,
          isLate: d.status === "DELIVERED" && classifyTimeliness(d) === "LATE",
          failureReason: d.failureReason,
          driverName: a?.driver.name ?? null,
          vehicleRegistration: a?.vehicle?.registrationNumber ?? null,
          zoneName: d.zone?.name ?? null,
          deliveryFeeBdt: d.deliveryFeeBdt,
        };
      }),
    });
  } catch (e) {
    return fail(e);
  }
}
