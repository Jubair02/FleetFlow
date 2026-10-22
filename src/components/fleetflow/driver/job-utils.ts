import { format, isToday, isYesterday } from "date-fns";
import type { Delivery, MyJob } from "@/lib/types";

/** Shared card surface for the driver portal (soft layered shadow in light, border-only in dark). */
export const CARD_SURFACE =
  "rounded-2xl border border-border/70 bg-card text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.15)] dark:border-white/10 dark:shadow-none";

/** Enter animation: fade + 4px rise, skipped when reduced motion is requested. */
export const ENTER_MOTION = "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200";

/** Press feedback for primary buttons. */
export const PRESS = "transition-[transform,background-color,color,box-shadow] duration-150 motion-safe:active:scale-[0.98]";

export type Transition = "PICKED_UP" | "IN_TRANSIT";

/** Current time — kept out of render bodies so components stay pure. */
export function now(): Date {
  return new Date();
}

export function isOverdue(job: Delivery): boolean {
  if (!job.expectedAt) return false;
  if (job.status === "DELIVERED" || job.status === "FAILED" || job.status === "CANCELLED") return false;
  return new Date(job.expectedAt).getTime() < Date.now();
}

/** How THIS driver's assignment ended — not the delivery's current status (it may have been reassigned since). */
export function jobOutcome(job: MyJob): string {
  return job.outcome ?? job.status;
}

export function jobEndedAt(job: MyJob): string | null {
  return job.endedAt ?? job.completedAt ?? null;
}

const STATUS_RANK: Record<string, number> = { IN_TRANSIT: 0, PICKED_UP: 1 };
const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** Most urgent first: on-the-road jobs, then priority, then earliest expected time. */
export function byUrgency(a: MyJob, b: MyJob): number {
  const s = (STATUS_RANK[a.status] ?? 2) - (STATUS_RANK[b.status] ?? 2);
  if (s !== 0) return s;
  const p = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
  if (p !== 0) return p;
  const ea = a.expectedAt ? new Date(a.expectedAt).getTime() : Number.POSITIVE_INFINITY;
  const eb = b.expectedAt ? new Date(b.expectedAt).getTime() : Number.POSITIVE_INFINITY;
  return ea - eb;
}

/** Before pickup the driver heads to the pickup point; afterwards to the recipient. */
export function navigationTarget(job: Delivery): { address: string; toPickup: boolean } {
  const toPickup = job.status === "ASSIGNED";
  return { address: toPickup ? job.pickupAddress : job.deliveryAddress, toPickup };
}

export function navigateUrl(job: Delivery): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(navigationTarget(job).address)}`;
}

/** Split "House 12, Road 5, Dhanmondi, Dhaka" into a headline and a trailing area line (formatting only). */
export function splitAddress(address: string): { line1: string; line2: string | null } {
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 3) return { line1: parts.slice(0, -2).join(", "), line2: parts.slice(-2).join(", ") };
  if (parts.length === 2) return { line1: parts[0], line2: parts[1] };
  return { line1: address.trim(), line2: null };
}

export function greeting(date: Date): string {
  const h = date.getHours();
  if (h >= 4 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  return "Good evening";
}

export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Day bucket label for the history list. */
export function dayLabel(iso: string | null): string {
  if (!iso) return "Earlier";
  const d = new Date(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, d MMM yyyy");
}

export function dayKey(iso: string | null): string {
  return iso ? format(new Date(iso), "yyyy-MM-dd") : "earlier";
}
