// ─────────────────────────────────────────────────────────────
// Report & dashboard metric definitions — pure functions, no DB.
//
// Every rate is a whole-number percentage, or null when its
// denominator is 0 (shown as "—", never as 0% or 100%).
// Missing timestamps are NEVER counted as on-time and never enter
// a duration: those rows are excluded and the exclusion is counted
// so the UI can say so.
//
//  Total            deliveries created in the range that match the filters
//  Status counts    current status: Delivered, Failed, Cancelled,
//                   Pending dispatch (CREATED),
//                   In progress (ASSIGNED | PICKED_UP | IN_TRANSIT)
//  Success rate     delivered ÷ (delivered + failed) — resolved attempts only
//  On-time rate     on-time ÷ (delivered WITH an expectedAt), where
//                   on-time = completedAt ≤ expectedAt and
//                   late    = completedAt > expectedAt.
//                   Delivered without a deadline are excluded (and counted).
//  Completion time  completedAt − createdAt of delivered deliveries (mean + median, hours)
//  Time on the road completedAt − assignedAt of the delivering assignment
//                   (Assignment.outcome = DELIVERED)
//  Per driver       assigned = distinct deliveries ever assigned to the driver,
//                   delivered = assignments closed DELIVERED,
//                   failed = assignments closed FAILED (each failed attempt counts),
//                   failure rate = failed ÷ (delivered + failed),
//                   on-time rate = same rule over the driver's delivered jobs.
// ─────────────────────────────────────────────────────────────

const HOUR_MS = 36e5;

export const IN_PROGRESS_STATUSES = ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"] as const;

/** Whole-number percentage, or null when the denominator is 0. */
export function percent(numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) return null;
  return Math.round((numerator / denominator) * 100);
}

/** One decimal place (hours), keeping null. */
export function round1(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10) / 10;
}

// ── Status counts ────────────────────────────────────────────

export interface StatusCounts {
  total: number;
  delivered: number;
  failed: number;
  cancelled: number;
  /** CREATED — not yet dispatched */
  pendingDispatch: number;
  /** ASSIGNED | PICKED_UP | IN_TRANSIT */
  inProgress: number;
}

export function summarizeStatuses(groups: { status: string; count: number }[]): StatusCounts {
  const of = (s: string) => groups.filter((g) => g.status === s).reduce((acc, g) => acc + g.count, 0);
  return {
    total: groups.reduce((acc, g) => acc + g.count, 0),
    delivered: of("DELIVERED"),
    failed: of("FAILED"),
    cancelled: of("CANCELLED"),
    pendingDispatch: of("CREATED"),
    inProgress: IN_PROGRESS_STATUSES.reduce((acc, s) => acc + of(s), 0),
  };
}

/** Delivered ÷ (delivered + failed). Cancelled and open deliveries are not attempts. */
export function successRate(delivered: number, failed: number): number | null {
  return percent(delivered, delivered + failed);
}

/** Failed ÷ (delivered + failed). */
export function failureRate(delivered: number, failed: number): number | null {
  return percent(failed, delivered + failed);
}

// ── Timeliness ───────────────────────────────────────────────

export type Timeliness = "ON_TIME" | "LATE" | "NO_DEADLINE" | "NO_COMPLETION_TIME";

type MaybeDate = Date | null | undefined;

/**
 * Timeliness of ONE delivered delivery. Only a delivery with both an
 * expectedAt and a completedAt can be on time or late; anything else
 * is unknown and must be excluded from the on-time rate.
 */
export function classifyTimeliness(d: { expectedAt: MaybeDate; completedAt: MaybeDate }): Timeliness {
  if (!d.expectedAt) return "NO_DEADLINE";
  if (!d.completedAt) return "NO_COMPLETION_TIME";
  return d.completedAt.getTime() <= d.expectedAt.getTime() ? "ON_TIME" : "LATE";
}

export interface OnTimeStats {
  onTime: number;
  late: number;
  /** Denominator: delivered with a deadline AND a completion time. */
  withDeadline: number;
  /** Delivered with no expectedAt — excluded from the rate. */
  withoutDeadline: number;
  /** Delivered with a deadline but no completedAt (data gap) — excluded. */
  missingCompletion: number;
  /** onTime ÷ withDeadline, null when withDeadline = 0. */
  rate: number | null;
}

/** On-time stats over DELIVERED rows (callers must pass delivered rows only). */
export function onTimeStats(rows: { expectedAt: MaybeDate; completedAt: MaybeDate }[]): OnTimeStats {
  let onTime = 0;
  let late = 0;
  let withoutDeadline = 0;
  let missingCompletion = 0;
  for (const r of rows) {
    const t = classifyTimeliness(r);
    if (t === "ON_TIME") onTime++;
    else if (t === "LATE") late++;
    else if (t === "NO_DEADLINE") withoutDeadline++;
    else missingCompletion++;
  }
  const withDeadline = onTime + late;
  return { onTime, late, withDeadline, withoutDeadline, missingCompletion, rate: percent(onTime, withDeadline) };
}

/**
 * Same rule from counts (used by the dashboard, where counting in SQL is cheaper):
 * deliveredWithDeadline must already exclude rows without completedAt.
 */
export function onTimeRateFromCounts(late: number, deliveredWithDeadline: number): number | null {
  return percent(Math.max(0, deliveredWithDeadline - late), deliveredWithDeadline);
}

// ── Durations ────────────────────────────────────────────────

export interface DurationStats {
  /** Rows that had both timestamps (and end ≥ start). */
  count: number;
  /** Rows dropped for a missing timestamp or end before start. */
  excluded: number;
  meanHours: number | null;
  medianHours: number | null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Mean/median of end − start in hours (1 decimal). Missing or negative spans are excluded and counted. */
export function durationStats(spans: { start: MaybeDate; end: MaybeDate }[]): DurationStats {
  const hours: number[] = [];
  let excluded = 0;
  for (const s of spans) {
    if (!s.start || !s.end || s.end.getTime() < s.start.getTime()) {
      excluded++;
      continue;
    }
    hours.push((s.end.getTime() - s.start.getTime()) / HOUR_MS);
  }
  const mean = hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null;
  return { count: hours.length, excluded, meanHours: round1(mean), medianHours: round1(median(hours)) };
}

// ── Failure reasons ──────────────────────────────────────────

/** Counts per failure reason code (null → "UNKNOWN"), largest first. */
export function failureReasonCounts(rows: { failureReason: string | null; count?: number }[]): { reason: string; count: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = r.failureReason || "UNKNOWN";
    map.set(key, (map.get(key) ?? 0) + (r.count ?? 1));
  }
  return Array.from(map, ([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

// ── Per driver ───────────────────────────────────────────────

export interface DriverAssignmentRow {
  driverId: string;
  deliveryId: string;
  /** DELIVERED | FAILED | CANCELLED | UNASSIGNED | null (still active) */
  outcome: string | null;
  assignedAt: MaybeDate;
  /** Assignment.completedAt (set when the assignment closes as DELIVERED). */
  completedAt: MaybeDate;
  delivery: { expectedAt: MaybeDate; completedAt: MaybeDate };
}

export interface DriverPerformance {
  driverId: string;
  /** Distinct deliveries ever assigned to this driver (in scope). */
  assigned: number;
  /** Assignments closed as DELIVERED. */
  delivered: number;
  /** Assignments closed as FAILED (each failed attempt counts). */
  failed: number;
  failureRate: number | null;
  onTime: number;
  late: number;
  /** Delivered by this driver with no deadline — excluded from the on-time rate. */
  deliveredWithoutDeadline: number;
  onTimeRate: number | null;
  avgRoadHours: number | null;
  /** Delivered jobs excluded from the road-time average (missing timestamps). */
  roadTimeExcluded: number;
}

/** When the delivering assignment ended: its own completedAt, else the delivery's (same transaction). */
function deliveringEnd(a: DriverAssignmentRow): MaybeDate {
  return a.completedAt ?? a.delivery.completedAt;
}

export function driverPerformance(rows: DriverAssignmentRow[]): DriverPerformance[] {
  const byDriver = new Map<string, DriverAssignmentRow[]>();
  for (const r of rows) {
    const list = byDriver.get(r.driverId);
    if (list) list.push(r);
    else byDriver.set(r.driverId, [r]);
  }
  return Array.from(byDriver, ([driverId, list]) => {
    const deliveredRows = list.filter((a) => a.outcome === "DELIVERED");
    const failed = list.filter((a) => a.outcome === "FAILED").length;
    const ot = onTimeStats(deliveredRows.map((a) => a.delivery));
    const road = durationStats(deliveredRows.map((a) => ({ start: a.assignedAt, end: deliveringEnd(a) })));
    return {
      driverId,
      assigned: new Set(list.map((a) => a.deliveryId)).size,
      delivered: deliveredRows.length,
      failed,
      failureRate: failureRate(deliveredRows.length, failed),
      onTime: ot.onTime,
      late: ot.late,
      deliveredWithoutDeadline: ot.withoutDeadline + ot.missingCompletion,
      onTimeRate: ot.rate,
      avgRoadHours: road.meanHours,
      roadTimeExcluded: road.excluded,
    };
  });
}

/** Road-time spans for delivered deliveries: the delivering assignment's assignedAt → completion. */
export function roadTimeSpans(
  delivered: { completedAt: MaybeDate; assignments: { assignedAt: MaybeDate; completedAt: MaybeDate }[] }[]
): { start: MaybeDate; end: MaybeDate }[] {
  return delivered.map((d) => {
    const a = d.assignments[0]; // caller selects only outcome = DELIVERED
    return { start: a?.assignedAt ?? null, end: a ? (a.completedAt ?? d.completedAt) : null };
  });
}
