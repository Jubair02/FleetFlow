// ─────────────────────────────────────────────────────────────
// Frontend API contract types — mirror of the REST responses
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
  role: "ADMIN" | "DRIVER";
  organizationId: string;
  organizationName: string;
  driverProfile: DriverProfileInfo | null;
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
  assignment: AssignmentInfo | null;
  podCount: number;
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
}

export interface PodItem {
  id: string;
  kind: string;
  recipientName: string;
  fileName: string;
  mimeType: string;
  capturedAt: string;
  uploadedById: string | null;
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
}

export interface DispatchData {
  unassigned: Delivery[];
  assignments: (AssignmentHistoryItem & { delivery: Delivery })[];
  drivers: DispatchDriver[];
  vehicles: DispatchVehicle[];
}

export interface MyJob extends Delivery {
  vehicle: { id: string; registrationNumber: string; type: string; capacity: string | null } | null;
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
  onTimeRate: number | null;
  lateCount: number;
}

export interface DashboardData {
  stats: DashboardStats;
  daily: { date: string; total: number; completed: number; failed: number }[];
  statusBreakdown: { status: string; count: number }[];
  priorityBreakdown: { priority: string; count: number }[];
  recentEvents: { id: string; eventType: string; note: string | null; actorName: string | null; createdAt: string; trackingCode: string; deliveryId: string }[];
  attention: {
    failedDeliveries: { id: string; trackingCode: string; recipientName: string; failureReason: string | null; createdAt: string }[];
    pendingUrgent: { id: string; trackingCode: string; recipientName: string; priority: string; expectedAt: string | null }[];
    maintenanceVehicles: { id: string; registrationNumber: string; type: string; status: string; notes: string | null }[];
  };
  driverWorkload: { id: string; name: string; active: boolean; availability: string; activeJobs: number; maxActiveJobs: number }[];
}

export interface ReportSummary {
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  completionRate: number | null;
  onTimeCount: number;
  lateCount: number;
  onTimeRate: number | null;
  avgCompletionHours: number | null;
}

export interface ReportData {
  summary: ReportSummary;
  driverBreakdown: { driverId: string; driverName: string; total: number; completed: number; failed: number; late: number }[];
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
    isLate: boolean;
    failureReason: string | null;
    driverName: string | null;
    vehicleRegistration: string | null;
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
  timeline: { eventType: string; note: string | null; timestamp: string }[];
}
