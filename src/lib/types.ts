import type { UserRole } from "@/lib/roles";
import type { SubscriptionAccess } from "@/lib/subscription";
// ─────────────────────────────────────────────────────────────
// Frontend API contract types — mirror of the REST responses
//
// Query-param conventions:
//  - Date range filters (`from`, `to`) on /api/deliveries and /api/reports
//    are ISO instants computed in the viewer's timezone: `from` = local
//    midnight of the first day (inclusive), `to` = local midnight of the
//    day AFTER the last day (exclusive).
//  - `tz` on /api/dashboard and /api/reports = Date#getTimezoneOffset()
//    of the viewer; daily buckets are keyed by the viewer's local date.
//  - /api/reports?export=1 returns every matching item (no table cap).
// ─────────────────────────────────────────────────────────────

export interface DriverProfileInfo {
  id: string;
  phone: string;
  licenseNumber: string;
  availability: string;
  maxActiveJobs: number;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
  /** The company's IANA timezone — every date in the app is shown in it (src/lib/format.ts). */
  timezone: string;
  driverProfile: DriverProfileInfo | null;
  /** Set after an admin creates/resets the password — the app forces a change. */
  mustChangePassword: boolean;
  /** The account that created the company. */
  isOwner: boolean;
  /** Trial / subscription state for banners; the server enforces it (src/lib/plans.ts). */
  subscription: SubscriptionAccess;
}

export interface AssignmentInfo {
  id: string;
  driverId: string;
  driverName: string;
  vehicleId: string;
  vehicleRegistration: string;
  vehicleType: string;
  assignedAt: string;
}

export interface Delivery {
  id: string;
  trackingCode: string;
  trackingToken: string | null;
  trackingEnabled: boolean;
  recipientName: string;
  recipientPhone: string;
  recipientEmail: string | null;
  /** The business's own order/invoice number. */
  externalRef: string | null;
  pickupAddress: string;
  deliveryAddress: string;
  instructions: string | null;
  priority: string;
  status: string;
  expectedAt: string | null;
  failureReason: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Cash on delivery (whole BDT); null = prepaid. */
  codAmount: number | null;
  codCollectedAmount: number | null;
  codCollectedAt: string | null;
  /** True once the collected cash was handed over to the office. */
  codSettled: boolean;
  /** Stop number in the assigned driver's planned route (1 = first); null/absent = not planned. */
  routeSeq?: number | null;
  /** Planned arrival estimate (ISO); null/absent = not planned or no map location. */
  plannedEta?: string | null;
  assignment: AssignmentInfo | null;
  podCount: number;
  /** Map point and who set it (GEOCODED | PIN | DRIVER | API); null/absent = not located yet. */
  location?: { lat: number; lng: number; source: string | null } | null;
  /** Zone & delivery charge (docs/ZONES.md); null/absent in driver views. */
  charge?: DeliveryCharge | null;
  /** Customer rating + reschedule request (docs/CUSTOMER-EXPERIENCE.md); null/absent in driver views. */
  customer?: DeliveryCustomerFeedback | null;
}

export interface DeliveryCustomerFeedback {
  rating: { score: number; comment: string | null; ratedAt: string | null } | null;
  reschedule: {
    /** PENDING | ACCEPTED | DECLINED */
    status: string;
    requestedFor: string | null;
    /** ANY | MORNING | AFTERNOON | EVENING */
    window: string | null;
    note: string | null;
    requestedAt: string | null;
    resolvedAt: string | null;
  } | null;
}

export interface DeliveryCharge {
  zoneId: string | null;
  zoneName: string | null;
  weightKg: number | null;
  /** Whole BDT; null = no zone matched / no price. */
  deliveryFeeBdt: number | null;
  /** True = typed by staff, never recalculated. */
  feeOverridden: boolean;
}

export interface DeliveryEventItem {
  id: string;
  eventType: string;
  note: string | null;
  actorName: string | null;
  customerVisible: boolean;
  createdAt: string;
}

export interface AssignmentHistoryItem {
  id: string;
  driverId: string;
  driverName: string;
  vehicleId: string;
  vehicleRegistration: string;
  vehicleType: string;
  assignedAt: string;
  unassignedAt: string | null;
  completedAt: string | null;
  active: boolean;
  /** Set when closed: DELIVERED | FAILED | CANCELLED | UNASSIGNED */
  outcome: string | null;
}

export interface PodItem {
  id: string;
  kind: string;
  recipientName: string;
  fileName: string;
  mimeType: string;
  capturedAt: string;
  uploadedById: string | null;
  /** Where the driver was when capturing proof, if the browser shared it. */
  location: { latitude: number; longitude: number; accuracyM: number | null } | null;
}

export interface DeliveryDetail {
  delivery: Delivery;
  events: DeliveryEventItem[];
  assignments: AssignmentHistoryItem[];
  pods: PodItem[];
}

export interface DeliveriesPage {
  items: Delivery[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Requests waiting for an answer across the organization (not just this page). */
  pendingReschedules?: number;
}

export interface DriverItem {
  id: string;
  name: string;
  email: string;
  active: boolean;
  phone: string;
  licenseNumber: string;
  availability: string;
  maxActiveJobs: number;
  activeJobs: number;
  completedTotal: number;
  failedTotal: number;
}

export interface VehicleItem {
  id: string;
  registrationNumber: string;
  type: string;
  capacity: string;
  status: string;
  notes: string;
  activeJobs: number;
  /** All-time assignments; a vehicle with history can't be deleted. */
  assignmentCount: number;
  createdAt: string;
}

export interface DispatchDriver {
  id: string;
  name: string;
  active: boolean;
  availability: string;
  maxActiveJobs: number;
  activeJobs: number;
}

export interface DispatchVehicle {
  id: string;
  registrationNumber: string;
  type: string;
  capacity: string;
  status: string;
  activeJobs: number;
  /** Driver currently holding this vehicle (one driver per vehicle at a time). */
  currentDriverId: string | null;
  currentDriverName: string | null;
}

export interface DispatchData {
  unassigned: Delivery[];
  /** Deliveries waiting in the queue — more than unassigned.length when the list is capped. */
  queueTotal?: number;
  assignments: (AssignmentHistoryItem & { delivery: Delivery })[];
  drivers: DispatchDriver[];
  vehicles: DispatchVehicle[];
}

export interface MyJob extends Delivery {
  vehicle: { id: string; registrationNumber: string; type: string; capacity: string | null } | null;
  /** History scope only: how THIS driver's assignment ended (DELIVERED | FAILED | CANCELLED). */
  outcome?: string | null;
  /** History scope only: when this driver's assignment ended. */
  endedAt?: string | null;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  deliveryId?: string | null;
  recipientEmail?: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditItem {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: string | null;
  createdAt: string;
}

export interface DashboardStats {
  total: number;
  pendingAssignment: number;
  inProgress: number;
  completed: number;
  failed: number;
  cancelled: number;
  activeDrivers: number;
  totalDrivers: number;
  vehiclesAttention: number;
  vehiclesTotal: number;
  /** On-time ÷ delivered-with-deadline (all time); null when no delivered job has a deadline. See src/lib/report-metrics.ts. */
  onTimeRate: number | null;
  lateCount: number;
  /** Denominator of onTimeRate: delivered with both expectedAt and completedAt. */
  onTimeEligible?: number;
  /** Delivered without a deadline (or completion time) — excluded from onTimeRate. */
  deliveredWithoutDeadline?: number;
}

export interface DashboardData {
  stats: DashboardStats;
  daily: { date: string; total: number; completed: number; failed: number }[];
  /** The viewer's local today (same buckets as `daily`): created, delivered, failed attempts. */
  today?: { created: number; delivered: number; failed: number };
  /** Live counts. Overdue = active (CREATED/ASSIGNED/PICKED_UP/IN_TRANSIT) past its deadline — a date-only
   * deadline lasts the whole local day. dueToday = active, due on local today and not yet overdue. */
  now?: { waiting: number; onTheRoad: number; overdue: number; dueToday: number };
  statusBreakdown: { status: string; count: number }[];
  priorityBreakdown: { priority: string; count: number }[];
  recentEvents: { id: string; eventType: string; note: string | null; actorName: string | null; createdAt: string; trackingCode: string; deliveryId: string }[];
  attention: {
    /** True totals — the lists below are capped at 5 rows. */
    failedCount: number;
    pendingUrgentCount: number;
    failedDeliveries: { id: string; trackingCode: string; recipientName: string; failureReason: string | null; createdAt: string }[];
    pendingUrgent: { id: string; trackingCode: string; recipientName: string; priority: string; expectedAt: string | null }[];
    maintenanceVehicles: { id: string; registrationNumber: string; type: string; status: string; notes: string | null }[];
    /** Most overdue first, capped at 5 — the true count is `now.overdue`. */
    overdueDeliveries?: { id: string; trackingCode: string; recipientName: string; status: string; expectedAt: string | null }[];
    /** Customer reschedule requests waiting for an answer (true count + first 5, oldest first). */
    rescheduleCount?: number;
    rescheduleRequests?: { id: string; trackingCode: string; requestedFor: string | null }[];
  };
  driverWorkload: { id: string; name: string; active: boolean; availability: string; activeJobs: number; maxActiveJobs: number }[];
}

/** Metric definitions: src/lib/report-metrics.ts (rates are whole %, null = no denominator). */
export interface ReportSummary {
  /** Deliveries created in the range matching the filters. */
  total: number;
  /** Current status counts. */
  completed: number;
  failed: number;
  cancelled: number;
  pendingDispatch: number;
  inProgress: number;
  /** delivered ÷ (delivered + failed) */
  successRate: number | null;
  /** On time: delivered with completedAt ≤ expectedAt. */
  onTimeCount: number;
  /** Late: delivered with completedAt > expectedAt. */
  lateCount: number;
  /** onTimeCount ÷ (onTimeCount + lateCount) */
  onTimeRate: number | null;
  /** Delivered without a deadline (or completion time) — excluded from the on-time rate. */
  deliveredWithoutDeadline: number;
  /** completedAt − createdAt over delivered deliveries (hours, 1 decimal). */
  avgCompletionHours: number | null;
  medianCompletionHours: number | null;
  completionTimeExcluded: number;
  /** completedAt − assignedAt of the delivering assignment (hours, 1 decimal). */
  avgRoadHours: number | null;
  medianRoadHours: number | null;
  roadTimeExcluded: number;
}

export interface ReportDriverRow {
  driverId: string;
  driverName: string;
  /** Distinct deliveries assigned to the driver. */
  assigned: number;
  /** Assignments closed DELIVERED. */
  delivered: number;
  /** Assignments closed FAILED (each failed attempt counts). */
  failed: number;
  failureRate: number | null;
  onTime: number;
  late: number;
  deliveredWithoutDeadline: number;
  onTimeRate: number | null;
  avgRoadHours: number | null;
  roadTimeExcluded: number;
  /** Customer rating of the deliveries this driver delivered (1 decimal); null = none rated. */
  avgRating?: number | null;
  ratingCount?: number;
}

export interface ReportData {
  summary: ReportSummary;
  /** Number of matching deliveries; `items` may be capped unless export=1. */
  itemsTotal: number;
  /** Timing metrics and the driver breakdown only used the most recent rows (very large range). */
  metricsTruncated?: boolean;
  driverBreakdown: ReportDriverRow[];
  /** Customer ratings from the tracking page (deliveries in range): count, average, 1–5 distribution. */
  ratings?: { count: number; average: number | null; distribution: [number, number, number, number, number] };
  /** Currently FAILED deliveries in range, grouped by reason (largest first). */
  failureReasons: { reason: string; label: string; count: number }[];
  /** Delivery charges in range (docs/ZONES.md): cancelled deliveries excluded; per zone, largest first. */
  charges?: {
    totalChargesBdt: number;
    deliveredChargesBdt: number;
    byZone: { zoneId: string | null; zoneName: string; deliveries: number; delivered: number; chargesBdt: number; deliveredChargesBdt: number }[];
  };
  daily: { date: string; total: number; completed: number; failed: number }[];
  items: {
    id: string;
    trackingCode: string;
    recipientName: string;
    status: string;
    priority: string;
    createdAt: string;
    expectedAt: string | null;
    completedAt: string | null;
    /** DELIVERED only: ON_TIME | LATE | NO_DEADLINE | NO_COMPLETION_TIME; null otherwise. */
    timeliness: string | null;
    isLate: boolean;
    failureReason: string | null;
    driverName: string | null;
    vehicleRegistration: string | null;
    zoneName?: string | null;
    /** Delivery charge, whole BDT; null = not priced. */
    deliveryFeeBdt?: number | null;
  }[];
}

export interface TrackingData {
  trackingCode: string;
  status: string;
  recipientName: string;
  deliveryAddress: string;
  expectedAt: string | null;
  createdAt: string;
  failureReason: string | null;
  /** Set when DELIVERED. */
  completedAt: string | null;
  /** The company sending the delivery (company name + public business phone from Settings). */
  sender: { name: string; phone: string | null };
  timeline: { eventType: string; note: string | null; timestamp: string }[];
}
