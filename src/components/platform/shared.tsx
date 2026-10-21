"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, KeyRound, LoaderCircle, RotateCw, ShieldCheck, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getPlan, type PlanCode } from "@/lib/plan-catalog";
import type { OrgStatus, SubscriptionStatus } from "@/lib/platform-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ── Constants & formatting ───────────────────────────────────

export const PLAN_CODES: PlanCode[] = ["trial", "starter", "growth", "business"];
export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELLED"];

export const SUBSCRIPTION_LABELS: Record<string, string> = {
  TRIAL: "Trial",
  ACTIVE: "Active",
  PAST_DUE: "Past due",
  CANCELLED: "Cancelled",
};

export const PROPOSED_PRICE_NOTE = "Proposed prices in BDT — not final, for discussion";

export function fmtNum(n: number | null | undefined): string {
  return typeof n === "number" ? n.toLocaleString("en-US") : "—";
}

export function formatBdt(amount: number): string {
  return `৳${amount.toLocaleString("en-US")}`;
}

export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

export function planName(code: string): string {
  const p = getPlan(code);
  return p.code === code.toLowerCase() ? p.name : `${code} (unknown → Trial)`;
}

/** "organization.suspend" / "ORG_SUSPENDED" → "Organization suspend" / "Org suspended". */
export function humanizeAction(action: string): string {
  const s = action.replace(/[._-]+/g, " ").trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : action;
}

/** Parse an audit `detail` JSON string into displayable key/value pairs — never throws. */
export function parseDetail(detail: string | null): { key: string; value: string }[] | string | null {
  if (!detail) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([key, v]) => ({
        key: humanizeAction(key.replace(/([a-z])([A-Z])/g, "$1 $2")),
        value: v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v),
      }));
    }
    return String(parsed);
  } catch {
    return detail;
  }
}

// ── Visual marker so staff never confuse this with a company workspace ──

export function PlatformBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 border-violet-300 bg-violet-50 text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300",
        className
      )}
    >
      <ShieldCheck aria-hidden /> Platform
    </Badge>
  );
}

// ── Status badges ────────────────────────────────────────────

export function OrgStatusBadge({ status }: { status: OrgStatus | string }) {
  const suspended = status === "SUSPENDED";
  return (
    <Badge
      variant="outline"
      className={cn(
        "whitespace-nowrap font-medium",
        suspended
          ? "border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
          : "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
      )}
    >
      {suspended ? "Suspended" : "Active"}
    </Badge>
  );
}

const SUB_STYLES: Record<string, string> = {
  TRIAL: "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  PAST_DUE: "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  CANCELLED: "border-zinc-200 bg-transparent text-zinc-500 dark:border-zinc-700 dark:text-zinc-400",
};

export function SubscriptionBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap font-medium", SUB_STYLES[status] ?? SUB_STYLES.TRIAL)}>
      {SUBSCRIPTION_LABELS[status] ?? status}
    </Badge>
  );
}

export function PlanBadge({ plan }: { plan: string }) {
  return (
    <Badge variant="outline" className="whitespace-nowrap border-primary/20 bg-primary/10 font-medium text-primary">
      {planName(plan)}
    </Badge>
  );
}

export function UserStatusBadge({ active }: { active: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "whitespace-nowrap font-medium",
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400"
      )}
    >
      {active ? "Active" : "Deactivated"}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return (
    <Badge variant="outline" className="whitespace-nowrap font-medium text-muted-foreground">
      {role === "ADMIN" ? "Admin" : role === "DRIVER" ? "Driver" : role}
    </Badge>
  );
}

// ── Copy helpers ─────────────────────────────────────────────

export function CopyIdButton({ id, label = "ID" }: { id: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select the ID and copy it manually");
    }
  };
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
      <span title={id}>{shortId(id)}</span>
      <button
        type="button"
        onClick={copy}
        onKeyDown={(e) => e.stopPropagation()}
        className="rounded p-0.5 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        aria-label={copied ? `${label} copied` : `Copy ${label} ${id}`}
      >
        {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
      </button>
    </span>
  );
}

// ── States ───────────────────────────────────────────────────

export function ErrorState({ title = "Couldn't load this", message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300 sm:flex-row sm:items-center"
    >
      <AlertTriangle className="size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-xs opacity-90">{message}</div>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0 bg-background">
          <RotateCw aria-hidden /> Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="text-sm font-medium">{title}</div>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── KPI card ─────────────────────────────────────────────────

type Tone = "emerald" | "amber" | "rose" | "teal" | "zinc" | "violet";

const TONE_STYLES: Record<Tone, string> = {
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  teal: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  zinc: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};

export function KpiCard({ icon: Icon, label, value, hint, tone = "emerald" }: { icon: LucideIcon; label: string; value: string; hint?: string; tone?: Tone }) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex items-start justify-between gap-3 px-4">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", TONE_STYLES[tone])}>
          <Icon className="size-4.5" aria-hidden />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Pagination ───────────────────────────────────────────────

export function PaginationBar({
  page,
  pageCount,
  total,
  pageSize,
  noun,
  onPage,
  disabled,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  noun: string;
  onPage: (p: number) => void;
  disabled?: boolean;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row">
      <span className="tabular-nums" aria-live="polite">
        {total === 0 ? `No ${noun}` : `${fmtNum(from)}–${fmtNum(to)} of ${fmtNum(total)} ${noun}`}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={() => onPage(page - 1)} disabled={disabled || page <= 1} aria-label="Previous page">
          <ChevronLeft aria-hidden /> Prev
        </Button>
        <span className="px-2 tabular-nums">
          Page {page} of {Math.max(1, pageCount)}
        </span>
        <Button variant="outline" size="sm" onClick={() => onPage(page + 1)} disabled={disabled || page >= pageCount} aria-label="Next page">
          Next <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}

// ── Forms ────────────────────────────────────────────────────

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-rose-600 dark:text-rose-400">
      {message}
    </p>
  );
}

export function errorProps(id: string, message?: string) {
  return message ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
}

export function ServerError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
      role="alert"
    >
      {message}
    </p>
  );
}

export function Callout({ tone = "amber", children, className }: { tone?: "amber" | "zinc" | "rose"; children: React.ReactNode; className?: string }) {
  const styles = {
    amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
    zinc: "border-border bg-muted/40 text-muted-foreground",
    rose: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
  } as const;
  return <div className={cn("rounded-lg border px-3 py-2 text-xs", styles[tone], className)}>{children}</div>;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Confirmation dialog ──────────────────────────────────────

/**
 * Confirm a platform action. `onConfirm` runs the request; a thrown error is
 * shown inline and the dialog stays open. Mount with a fresh `key` per open.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  destructive = false,
  canConfirm = true,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  canConfirm?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canConfirm || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The action failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={run} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription asChild><div className="text-sm text-muted-foreground">{description}</div></DialogDescription>}
          </DialogHeader>
          {children}
          <ServerError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={submitting || !canConfirm}>
              {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── One-time temporary password ──────────────────────────────

export interface TempPasswordInfo {
  title: string;
  email: string;
  password: string;
  note?: string;
}

/** Shows a temporary password exactly once. The API never returns it again. */
export function TempPasswordDialog({ info, onClose }: { info: TempPasswordInfo | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.password);
      setCopied(true);
      toast.success("Temporary password copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the password and copy it manually");
    }
  };
  return (
    <Dialog open={info !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" aria-hidden />
            {info?.title}
          </DialogTitle>
          <DialogDescription>
            Sign-in email: <span className="font-medium text-foreground">{info?.email}</span>
          </DialogDescription>
        </DialogHeader>
        {info?.note && <p className="text-sm text-muted-foreground">{info.note}</p>}
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <code className="min-w-0 flex-1 select-all break-all font-mono text-lg tracking-wider" aria-label="Temporary password">
            {info?.password}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0">
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <Callout>
          Shown only once — FleetFlow does not store it in readable form. Share it privately (in person, by phone or a direct
          message), never in a group chat or ticket. They must choose their own password at first sign-in.
        </Callout>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            I&apos;ve shared it — close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Usage vs limit ───────────────────────────────────────────

export function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const over = limit !== null && used > limit;
  const near = limit !== null && !over && limit > 0 && used / limit >= 0.8;
  const width = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, (used / limit) * 100);
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="first-letter:uppercase">{label}</span>
        <span
          className={cn(
            "shrink-0 tabular-nums text-xs",
            over ? "font-medium text-rose-600 dark:text-rose-400" : near ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground"
          )}
        >
          {limit === null ? `${fmtNum(used)} · unlimited` : `${fmtNum(used)} of ${fmtNum(limit)}`}
          {over && " · over limit"}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit ?? used}
        aria-valuenow={used}
        aria-valuetext={limit === null ? `${used}, unlimited` : `${used} of ${limit}`}
      >
        {limit !== null && (
          <div className={cn("h-full rounded-full", over ? "bg-rose-500" : near ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${width}%` }} />
        )}
      </div>
    </li>
  );
}
