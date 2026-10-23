// ─────────────────────────────────────────────────────────────
// Dashboard "right now" deadline rules — pure functions, no DB.
//
// Deadlines are evaluated in the VIEWER's timezone (`tzOffset` =
// their Date#getTimezoneOffset(), minutes; local = UTC − offset).
//
//  Date-only deadline  expectedAt is exactly local midnight → the
//                      delivery has the whole day, so it is only
//                      overdue from the NEXT local midnight
//                      (mirrors deadlineMs() in src/lib/format.ts).
//  Overdue             active delivery whose deadline has passed.
//  Due today           active delivery whose expectedAt falls on the
//                      viewer's local today and is NOT yet overdue.
// ─────────────────────────────────────────────────────────────

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses that still need work — the only ones that can be overdue. */
export const ACTIVE_DELIVERY_STATUSES = ["CREATED", "ASSIGNED", "PICKED_UP", "IN_TRANSIT"] as const;

/** True when `d` is local midnight in the viewer's timezone (second precision, like isDateOnly()). */
export function isDateOnlyInTz(d: Date, tzOffset: number): boolean {
  const local = d.getTime() - tzOffset * 60_000;
  const rem = ((local % DAY_MS) + DAY_MS) % DAY_MS;
  return rem < 1000;
}

/** Instant (ms) at which a deadline passes. */
export function deadlinePassesAt(expectedAt: Date, tzOffset: number): number {
  return isDateOnlyInTz(expectedAt, tzOffset) ? expectedAt.getTime() + DAY_MS : expectedAt.getTime();
}

export function isPastDeadline(expectedAt: Date, nowMs: number, tzOffset: number): boolean {
  return deadlinePassesAt(expectedAt, tzOffset) < nowMs;
}

export interface DeadlineSummary<T> {
  /** Overdue rows, most overdue first. */
  overdue: T[];
  /** Due on the viewer's local today and not yet overdue. */
  dueToday: number;
}

/**
 * Split active deliveries with a deadline into overdue / still due today.
 * `todayStartMs` = local midnight of the viewer's today (as an instant).
 * Callers pass only active (non-terminal) deliveries.
 */
export function summarizeDeadlines<T extends { expectedAt: Date | null }>(
  rows: T[],
  nowMs: number,
  tzOffset: number,
  todayStartMs: number,
): DeadlineSummary<T> {
  const tomorrowStartMs = todayStartMs + DAY_MS;
  const overdue: { row: T; passes: number }[] = [];
  let dueToday = 0;
  for (const row of rows) {
    if (!row.expectedAt) continue;
    const passes = deadlinePassesAt(row.expectedAt, tzOffset);
    if (passes < nowMs) {
      overdue.push({ row, passes });
      continue;
    }
    const t = row.expectedAt.getTime();
    if (t >= todayStartMs && t < tomorrowStartMs) dueToday++;
  }
  overdue.sort((a, b) => a.passes - b.passes);
  return { overdue: overdue.map((o) => o.row), dueToday };
}
