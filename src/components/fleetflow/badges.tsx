"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  STATUS_LABELS,
  PRIORITY_LABELS,
  VEHICLE_TYPE_LABELS,
  AVAILABILITY_LABELS,
  type DeliveryStatus,
  type Priority,
} from "@/lib/constants";
import {
  Clock,
  UserCheck,
  PackageCheck,
  Truck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Wrench,
  CircleOff,
  type LucideIcon,
} from "lucide-react";

// ── Delivery status ──────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  CREATED: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700",
  ASSIGNED: "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800",
  PICKED_UP: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
  IN_TRANSIT: "bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800",
  DELIVERED: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
  FAILED: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800",
  CANCELLED: "bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-800/40 dark:text-zinc-400 dark:border-zinc-700 line-through",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium whitespace-nowrap", STATUS_STYLES[status] ?? STATUS_STYLES.CREATED, className)}>
      {STATUS_LABELS[status as DeliveryStatus] ?? status}
    </Badge>
  );
}

export const STATUS_ICONS: Record<string, LucideIcon> = {
  CREATED: Clock,
  ASSIGNED: UserCheck,
  PICKED_UP: PackageCheck,
  IN_TRANSIT: Truck,
  DELIVERED: CheckCircle2,
  FAILED: AlertTriangle,
  CANCELLED: XCircle,
};

// ── Priority ─────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, string> = {
  URGENT: "bg-rose-600 text-white border-rose-600",
  HIGH: "bg-amber-500 text-white border-amber-500",
  NORMAL: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  LOW: "bg-transparent text-zinc-400 border-zinc-200 dark:border-zinc-700",
};

export function PriorityBadge({ priority, className }: { priority: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium whitespace-nowrap", PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.NORMAL, className)}>
      {priority === "URGENT" && <span className="mr-1 inline-block size-1.5 rounded-full bg-white animate-pulse" />}
      {PRIORITY_LABELS[priority as Priority] ?? priority}
    </Badge>
  );
}

// ── Vehicle status ───────────────────────────────────────────

export function VehicleStatusBadge({ status }: { status: string }) {
  if (status === "ACTIVE") {
    return (
      <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
        <CheckCircle2 className="size-3 mr-1" /> Active
      </Badge>
    );
  }
  if (status === "MAINTENANCE") {
    return (
      <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800">
        <Wrench className="size-3 mr-1" /> Maintenance
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-800/40 dark:text-zinc-400 dark:border-zinc-700">
      <CircleOff className="size-3 mr-1" /> Inactive
    </Badge>
  );
}

export function VehicleTypeLabel({ type }: { type: string }) {
  return <>{VEHICLE_TYPE_LABELS[type as keyof typeof VEHICLE_TYPE_LABELS] ?? type}</>;
}

// ── Driver availability ──────────────────────────────────────

export function AvailabilityBadge({ availability }: { availability: string }) {
  if (availability === "AVAILABLE") {
    return (
      <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
        <span className="size-1.5 rounded-full bg-emerald-500 mr-1" /> Available
      </Badge>
    );
  }
  if (availability === "ON_ROUTE") {
    return (
      <Badge variant="outline" className="bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800">
        <Truck className="size-3 mr-1" /> On route
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-800/40 dark:text-zinc-400 dark:border-zinc-700">
      <span className="size-1.5 rounded-full bg-zinc-400 mr-1" /> Off duty
    </Badge>
  );
}

export { AVAILABILITY_LABELS };
