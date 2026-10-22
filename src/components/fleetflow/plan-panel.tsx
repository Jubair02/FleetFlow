"use client";

import { AlertTriangle, Check, CreditCard, Lock, Mail, Minus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError, useApiData } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OrgPlanInfo } from "@/lib/types-org";
import { goToSettings } from "@/store/app-store";
// Plan types & feature catalog from the client-safe module; live plan data comes from the API.
import {
  FEATURE_KEYS,
  FEATURES,
  type BillingCycle,
  type FeatureKey,
  type PlanDefinition,
  type PlanResource,
} from "@/lib/plan-catalog";

// ─────────────────────────────────────────────────────────────
// Plan & usage panel (admin), shared pricing cards, and the
// feature-gate helpers used by the deliveries import and reports
// export. No payment integration: plans are changed manually by the
// FleetFlow team (see docs/BILLING.md).
// ─────────────────────────────────────────────────────────────

export interface BillingSubscription {
  status: string;
  billingCycle: BillingCycle;
  /** Agreed price per cycle; null = free. */
  priceBdt: number | null;
  paidUntil: string | null;
  planAssignedAt: string | null;
  /** Current list price of the plan on this cycle (null = free / not offered). */
  listPriceBdt: number | null;
}

/** GET /api/billing (admin). */
export interface BillingData {
  plan: PlanDefinition;
  usage: Record<PlanResource, number>;
  plans: PlanDefinition[];
  resourceLabels: Record<PlanResource, string>;
  billingContact: string | null;
  subscription: BillingSubscription;
}

const RESOURCE_ORDER: PlanResource[] = ["monthlyDeliveries", "drivers", "vehicles", "admins"];
/** Usage at or above this share of a limit is shown in amber. */
const NEAR_LIMIT = 0.8;

export const PROPOSED_PRICING_NOTE = "Proposed prices in BDT — not final, for discussion";

const CYCLE_LABELS: Record<BillingCycle, string> = { MONTHLY: "Monthly", ANNUAL: "Annual" };
const SUBSCRIPTION_LABELS: Record<string, string> = { TRIAL: "Trial", ACTIVE: "Active", PAST_DUE: "Past due", CANCELLED: "Cancelled" };

export function formatBdt(amount: number): string {
  return `৳${amount.toLocaleString("en-US")}`;
}

function formatCyclePrice(amount: number | null, cycle: BillingCycle): string {
  return amount == null ? "Free" : `${formatBdt(amount)} / ${cycle === "ANNUAL" ? "year" : "month"}`;
}

// ── Feature gates (deliveries import, reports export) ────────

/** `planInfo` from GET /api/org (type defined with the API contract). */
export type { OrgPlanInfo };

/**
 * The organization's plan features. `locked(f)` is true only once we KNOW the
 * plan lacks the feature — while loading (or if the API didn't say) the UI stays
 * permissive and the server's 403 is handled where the request is made.
 */
export function useOrgPlanInfo() {
  const { data } = useApiData<{ planInfo?: OrgPlanInfo | null }>("/api/org");
  const planInfo = data?.planInfo ?? null;
  return {
    planInfo,
    locked: (feature: FeatureKey) => !!planInfo && !planInfo.features.includes(feature),
  };
}

/** True for the server's "not in your plan" refusal. */
export function isPlanRefusal(err: unknown): err is ApiRequestError {
  return err instanceof ApiRequestError && err.status === 403;
}

const UPGRADE_COPY: Record<FeatureKey, { title: string; action: string }> = {
  csv_import: { title: "Upgrade to import deliveries", action: "bulk-import deliveries from a CSV file" },
  report_export: { title: "Upgrade to export reports", action: "download reports as CSV" },
  customer_emails: { title: "Upgrade to email customers", action: "email recipients their tracking link and delivery outcome" },
};

/** Body of the "this feature isn't in your plan" explainer — inline or inside UpgradeDialog. */
export function UpgradeExplainer({ feature, planName, message, className }: { feature: FeatureKey; planName?: string | null; message?: string | null; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 text-sm", className)}>
      <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium">
            {FEATURES[feature].label} isn&apos;t included in {planName ? `your ${planName} plan` : "your current plan"}.
          </p>
          <p className="text-muted-foreground">
            Upgrade to {UPGRADE_COPY[feature].action}. {FEATURES[feature].description}.
          </p>
          {message && <p className="text-xs text-muted-foreground">{message}</p>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        There&apos;s nothing to pay online — contact the FleetFlow team and we&apos;ll switch your plan. Your data stays exactly as it is.
      </p>
    </div>
  );
}

/** Dialog shown instead of a feature the plan doesn't include. "See plans" opens Settings → Plan. */
export function UpgradeDialog({
  feature,
  planName,
  message,
  open,
  onOpenChange,
}: {
  feature: FeatureKey;
  planName?: string | null;
  /** Server's refusal message, when the dialog was opened by a 403. */
  message?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{UPGRADE_COPY[feature].title}</DialogTitle>
          <DialogDescription>Available on higher plans.</DialogDescription>
        </DialogHeader>
        <UpgradeExplainer feature={feature} planName={planName} message={message} />
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            className="min-h-11 sm:min-h-9"
            onClick={() => {
              onOpenChange(false);
              goToSettings("plan");
            }}
          >
            <CreditCard aria-hidden="true" /> See plans
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Usage ────────────────────────────────────────────────────

type UsageState = "ok" | "near" | "at" | "over" | "unlimited";

function usageState(used: number, limit: number | null): UsageState {
  if (limit === null) return "unlimited";
  if (used > limit) return "over";
  if (used === limit) return "at";
  return limit > 0 && used / limit >= NEAR_LIMIT ? "near" : "ok";
}

const BAR_TONE: Record<UsageState, string> = {
  ok: "bg-emerald-500",
  near: "bg-amber-500",
  at: "bg-amber-500",
  over: "bg-rose-500",
  unlimited: "bg-emerald-500",
};

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const state = usageState(used, limit);
  const width = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, (used / limit) * 100);
  const note =
    state === "over"
      ? `Over the limit by ${used - (limit ?? 0)}. Existing records are kept, but new ones can't be added until you upgrade or reduce usage.`
      : state === "at"
        ? "Limit reached — new additions are blocked until you upgrade."
        : state === "near"
          ? "Approaching the limit."
          : null;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="first-letter:uppercase">{label}</span>
        <span
          className={cn(
            "shrink-0 tabular-nums",
            state === "over" ? "font-medium text-rose-600 dark:text-rose-400" : state === "near" || state === "at" ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground"
          )}
        >
          {limit === null ? `${used} · unlimited` : `${used} of ${limit}`}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit ?? used}
        aria-valuenow={used}
        aria-valuetext={limit === null ? `${used}, unlimited` : `${used} of ${limit}`}
      >
        {limit !== null && <div className={cn("h-full rounded-full transition-all", BAR_TONE[state])} style={{ width: `${width}%` }} />}
      </div>
      {note && (
        <p className={cn("text-xs", state === "over" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400")}>{note}</p>
      )}
    </li>
  );
}

function limitLine(limit: number | null, label: string): string {
  // Usage labels read as "this month"; a plan limit is a monthly allowance.
  const allowance = label.replace("this month", "per month");
  if (limit === null) return `Unlimited ${allowance}`;
  const noun = limit === 1 ? allowance.replace(/accounts$/, "account") : allowance;
  return `${limit.toLocaleString("en-US")} ${noun}`;
}

// ── Pricing cards ────────────────────────────────────────────

function CardPrice({ plan }: { plan: Pick<PlanDefinition, "monthlyPriceBdt" | "annualPriceBdt"> }) {
  const m = plan.monthlyPriceBdt;
  const a = plan.annualPriceBdt;
  if (m == null && a == null) {
    return (
      <div>
        <p className="text-2xl font-semibold tracking-tight">Free</p>
        <p className="mt-0.5 text-xs text-muted-foreground">no payment needed</p>
      </div>
    );
  }
  const saving = m != null && a != null && m > 0 && a < m * 12 ? Math.round((1 - a / (m * 12)) * 100) : 0;
  return (
    <div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">
        {formatBdt(m ?? a!)}
        <span className="ml-1 text-sm font-normal text-muted-foreground">/ {m != null ? "month" : "year"}</span>
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
        {m != null && a != null
          ? `or ${formatBdt(a)} / year${saving > 0 ? ` (save ${saving}%)` : ""} · proposed, BDT`
          : `${m != null ? "billed monthly" : "billed annually"} · proposed, BDT`}
      </p>
    </div>
  );
}

const GRID_COLS: Record<number, string> = {
  1: "md:grid-cols-1 md:max-w-sm",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
};

/**
 * Plans as pricing cards. Pure presentational — used by PlanPanel (data from
 * /api/billing) and by PricingTable (data from the public /api/plans).
 * Shows the plans it's given that are active and public, plus the current plan.
 */
export function PlanCards({
  plans,
  resourceLabels,
  currentCode,
}: {
  plans: PlanDefinition[];
  resourceLabels: Record<PlanResource, string>;
  currentCode?: string;
}) {
  const shown = plans
    .filter((p) => (p.active && p.isPublic) || p.code === currentCode)
    .slice()
    .sort((x, y) => x.sortOrder - y.sortOrder);
  if (shown.length === 0) {
    return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No plans are listed right now — contact the FleetFlow team for pricing.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className={cn("grid gap-4", GRID_COLS[shown.length] ?? "md:grid-cols-2 xl:grid-cols-4")}>
        {shown.map((p) => {
          const current = p.code === currentCode;
          const priced = p.monthlyPriceBdt != null || p.annualPriceBdt != null;
          return (
            <div
              key={p.code}
              className={cn("flex flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground", current && "border-primary/50 ring-1 ring-primary/30")}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-semibold">{p.name}</p>
                  {p.description && <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>}
                </div>
                {current ? (
                  <Badge variant="outline" className="shrink-0 border-primary/30 bg-primary/10 text-primary">
                    Current plan
                  </Badge>
                ) : priced ? (
                  <Badge variant="outline" className="shrink-0 text-muted-foreground">
                    Proposed
                  </Badge>
                ) : null}
              </div>
              <CardPrice plan={p} />
              <ul className="flex flex-col gap-1.5 text-sm">
                {RESOURCE_ORDER.map((r) => (
                  <li key={r} className="tabular-nums">
                    {limitLine(p.limits[r], resourceLabels[r])}
                  </li>
                ))}
              </ul>
              {p.highlights.length > 0 && (
                <ul className="flex flex-col gap-1.5 border-t pt-3 text-sm text-muted-foreground">
                  {p.highlights.map((h, i) => (
                    <li key={`${i}-${h}`} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{PROPOSED_PRICING_NOTE}. No online payment — plans are changed by the FleetFlow team.</p>
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function PlanPanel() {
  const { data, error, reload } = useApiData<BillingData>("/api/billing");

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertTitle>Failed to load your plan</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          {error}
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-5 w-40" />
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { plan, usage, resourceLabels } = data;
  const sub = data.subscription;
  const cycle = sub?.billingCycle ?? "MONTHLY";
  const agreed = sub?.priceBdt ?? null;
  const list = sub?.listPriceBdt ?? null;
  const priceDiffers = !!sub && agreed !== list;
  const free = plan.monthlyPriceBdt == null && plan.annualPriceBdt == null;
  const overLimits = RESOURCE_ORDER.filter((r) => {
    const s = usageState(usage[r], plan.limits[r]);
    return s === "over" || s === "at";
  });
  const features = plan.features ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="text-base">Your plan</CardTitle>
            <CardDescription className="text-xs">Usage against your plan limits · deliveries count from the 1st of this month</CardDescription>
          </div>
          <CardAction>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              <CreditCard className="size-3.5" aria-hidden="true" /> {plan.name}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {sub && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-4">
              <DetailRow label="Billing cycle">{CYCLE_LABELS[cycle] ?? cycle}</DetailRow>
              <DetailRow label="Your price">
                <span className="tabular-nums">{formatCyclePrice(agreed, cycle)}</span>
                {priceDiffers && (
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    List price now {list == null ? "not offered on this cycle" : formatCyclePrice(list, cycle)} — you keep your agreed price.
                  </span>
                )}
              </DetailRow>
              <DetailRow label="Paid until">
                {sub.paidUntil ? formatDate(sub.paidUntil) : "—"}
                {sub.status && sub.status !== "ACTIVE" && <span className="block text-xs text-muted-foreground">{SUBSCRIPTION_LABELS[sub.status] ?? sub.status}</span>}
              </DetailRow>
              <DetailRow label="On this plan since">{sub.planAssignedAt ? formatDate(sub.planAssignedAt) : "—"}</DetailRow>
            </dl>
          )}
          {overLimits.length > 0 && (
            <Alert className="border-amber-500/40 bg-amber-500/5">
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
              <AlertTitle>Plan limit reached</AlertTitle>
              <AlertDescription>
                {overLimits.map((r) => resourceLabels[r]).join(", ")}: new additions are blocked. Nothing you already have is removed or
                disabled.
              </AlertDescription>
            </Alert>
          )}
          <ul className="grid gap-x-8 gap-y-5 md:grid-cols-2">
            {RESOURCE_ORDER.map((r) => (
              <UsageRow key={r} label={resourceLabels[r]} used={usage[r]} limit={plan.limits[r]} />
            ))}
          </ul>
          <div className="border-t pt-4">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Features</h3>
            <ul className="grid gap-2 sm:grid-cols-3">
              {FEATURE_KEYS.map((f) => {
                const on = features.includes(f);
                return (
                  <li key={f} className={cn("flex items-start gap-2 text-sm", !on && "text-muted-foreground")}>
                    {on ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    ) : (
                      <Minus className="mt-0.5 size-4 shrink-0 opacity-60" aria-hidden="true" />
                    )}
                    <span>
                      {FEATURES[f].label}
                      <span className="block text-xs text-muted-foreground">{on ? "Included" : "Not included — available on higher plans"}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          {free && (
            <p className="text-xs text-muted-foreground">You are on a free plan. Pick a plan below when you are ready — there is nothing to pay online.</p>
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="plan-pricing-title" className="flex flex-col gap-3">
        <div>
          <h2 id="plan-pricing-title" className="text-base font-semibold">
            Proposed pricing
          </h2>
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">{PROPOSED_PRICING_NOTE}</p>
        </div>
        <PlanCards plans={data.plans} resourceLabels={resourceLabels} currentCode={plan.code} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How to upgrade</CardTitle>
          <CardDescription className="text-xs">There is no online payment yet</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-muted-foreground">
            <li>Contact the FleetFlow team and tell us which plan and billing cycle (monthly or annual) you want.</li>
            <li>We send an invoice; pay by bKash or bank transfer.</li>
            <li>We switch your plan as soon as payment is confirmed — your data stays exactly as it is.</li>
          </ol>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mail className="size-4 shrink-0" aria-hidden="true" />
            {data.billingContact ? (
              <span>
                Invoices are sent to <span className="font-medium text-foreground">{data.billingContact}</span>.
              </span>
            ) : (
              <span>No billing email on file — add a contact email in your organization settings so invoices reach you.</span>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
