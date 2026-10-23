import { failureReasonLabel } from "@/lib/constants";
import { friendlyDueDate } from "@/lib/format";
import type { DashboardData } from "@/lib/types";

// ─────────────────────────────────────────────────────────────
// Pure view-model helpers for the operations dashboard.
// ─────────────────────────────────────────────────────────────

/** "FF-1001, FF-1002 +3 more" — first codes of a capped list, against the true count. */
export function codesSummary(codes: string[], total: number, show = 2): string {
  const shown = codes.slice(0, show);
  if (shown.length === 0) return "";
  const rest = Math.max(0, total - shown.length);
  return rest > 0 ? `${shown.join(", ")} +${rest} more` : shown.join(", ");
}

export type AttentionKind = "overdue" | "failed" | "urgent" | "vehicles";

export interface AttentionItem {
  kind: AttentionKind;
  count: number;
  /** Short context line: first codes / registrations plus a reason or due date. */
  context: string;
  /** Set when exactly one delivery is behind the row, so the action can open it directly. */
  singleDeliveryId: string | null;
}

/** Prioritised "needs attention" rows (only non-zero ones), most pressing first. */
export function attentionItems(d: DashboardData, due: (iso: string | null) => string = friendlyDueDate): AttentionItem[] {
  const a = d.attention;
  const overdueList = a.overdueDeliveries ?? [];
  const overdueCount = d.now?.overdue ?? overdueList.length;
  const failedCount = a.failedCount ?? a.failedDeliveries.length;
  const urgentCount = a.pendingUrgentCount ?? a.pendingUrgent.length;
  const vehicles = a.maintenanceVehicles;

  const items: AttentionItem[] = [
    {
      kind: "overdue",
      count: overdueCount,
      context: [
        codesSummary(overdueList.map((o) => o.trackingCode), overdueCount),
        overdueList[0]?.expectedAt ? `was due ${due(overdueList[0].expectedAt)}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      singleDeliveryId: overdueCount === 1 ? (overdueList[0]?.id ?? null) : null,
    },
    {
      kind: "failed",
      count: failedCount,
      context: [
        codesSummary(a.failedDeliveries.map((f) => f.trackingCode), failedCount),
        a.failedDeliveries[0] ? failureReasonLabel(a.failedDeliveries[0].failureReason) : "",
      ]
        .filter(Boolean)
        .join(" · "),
      singleDeliveryId: failedCount === 1 ? (a.failedDeliveries[0]?.id ?? null) : null,
    },
    {
      kind: "urgent",
      count: urgentCount,
      context: [
        codesSummary(a.pendingUrgent.map((p) => p.trackingCode), urgentCount),
        a.pendingUrgent[0] ? `first due ${due(a.pendingUrgent[0].expectedAt)}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      singleDeliveryId: null,
    },
    {
      kind: "vehicles",
      count: vehicles.length,
      context: codesSummary(
        vehicles.map((v) => v.registrationNumber),
        vehicles.length,
      ),
      singleDeliveryId: null,
    },
  ];
  return items.filter((i) => i.count > 0);
}

export interface StatusSegment {
  key: "waiting" | "progress" | "delivered" | "failed" | "cancelled";
  label: string;
  count: number;
  /** Share of all deliveries, 0–100 (unrounded, for bar widths). */
  share: number;
}

/** Current status mix collapsed into five readable groups. */
export function statusSegments(breakdown: DashboardData["statusBreakdown"]): StatusSegment[] {
  const of = (...s: string[]) => breakdown.filter((b) => s.includes(b.status)).reduce((n, b) => n + b.count, 0);
  const groups: Omit<StatusSegment, "share">[] = [
    { key: "waiting", label: "Waiting", count: of("CREATED") },
    { key: "progress", label: "In progress", count: of("ASSIGNED", "PICKED_UP", "IN_TRANSIT") },
    { key: "delivered", label: "Delivered", count: of("DELIVERED") },
    { key: "failed", label: "Failed", count: of("FAILED") },
    { key: "cancelled", label: "Cancelled", count: of("CANCELLED") },
  ];
  const total = groups.reduce((n, g) => n + g.count, 0);
  return groups.map((g) => ({ ...g, share: total > 0 ? (g.count / total) * 100 : 0 }));
}

/** Totals across the chart window. */
export function sumDaily(daily: DashboardData["daily"]): { created: number; delivered: number; failed: number } {
  return daily.reduce(
    (acc, d) => ({ created: acc.created + d.total, delivered: acc.delivered + d.completed, failed: acc.failed + d.failed }),
    { created: 0, delivered: 0, failed: 0 },
  );
}

type Workload = DashboardData["driverWorkload"][number];

function workloadRank(w: Workload): number {
  if (!w.active) return 3;
  if (w.availability === "AVAILABLE") return 0;
  if (w.availability === "ON_ROUTE") return 1;
  return 2;
}

/** Available first, then on route, off duty, inactive; busiest first within a group; capped. */
export function topDrivers(workload: Workload[], max = 6): Workload[] {
  return [...workload]
    .sort((a, b) => workloadRank(a) - workloadRank(b) || b.activeJobs - a.activeJobs || a.name.localeCompare(b.name))
    .slice(0, max);
}
