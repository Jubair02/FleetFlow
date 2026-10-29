"use client";

import { AlertTriangle, CalendarCheck, CalendarClock, Check, CreditCard, Lock, Mail, Sparkles, Wallet } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  ok: "bg-gradient-to-r from-emerald-500 to-teal-500",
  near: "bg-amber-500",
  at: "bg-amber-500",
  over: "bg-rose-500",
  unlimited: "bg-gradient-to-r from-emerald-500/40 to-teal-500/40",
};

const TILE_TONE: Record<UsageState, string> = {
  ok: "",
  near: "border-amber-300/70 dark:border-amber-800/70",
  at: "border-amber-300/70 dark:border-amber-800/70",
  over: "border-rose-300/80 bg-rose-50/40 dark:border-rose-900 dark:bg-rose-950/20",
  unlimited: "",
};

function UsageTile({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const state = usageState(used, limit);
  const width = limit === null || limit === 0 ? 100 : Math.min(100, (used / limit) * 100);
  const note =
    state === "over"
      ? `Over the limit by ${used - (limit ?? 0)}. Existing records are kept, but new ones can't be added until you upgrade or reduce usage.`
      : state === "at"
        ? "Limit reached — new additions are blocked until you upgrade."
        : state === "near"
          ? "Approaching the limit."
          : null;
  return (
    <li className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4", TILE_TONE[state])}>
      <span className="text-xs font-medium text-muted-foreground first-letter:uppercase">{label}</span>
      <span className="flex items-baseline gap-1.5 tabular-nums">
        <span
          className={cn(
            "text-2xl leading-none font-semibold tracking-tight",
            state === "over" ? "text-rose-600 dark:text-rose-400" : state === "near" || state === "at" ? "text-amber-600 dark:text-amber-400" : ""
          )}
        >
          {used.toLocaleString("en-US")}
        </span>
        <span className="text-sm text-muted-foreground">{limit === null ? "· unlimited" : `/ ${limit.toLocaleString("en-US")}`}</span>
      </span>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit ?? used}
        aria-valuenow={used}
        aria-valuetext={limit === null ? `${used}, unlimited` : `${used} of ${limit}`}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-500", BAR_TONE[state])} style={{ width: `${width}%` }} />
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

const PANEL = "rounded-2xl border bg-card text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04)]";

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  TRIAL: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  PAST_DUE: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  CANCELLED: "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
};

function DetailRow({ icon: Icon, label, children }: { icon: typeof CreditCard; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm font-medium">{children}</dd>
      </div>
    </div>
  );
}

function SectionHeading({ id, title, children }: { id: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <h3 id={id} className="text-base font-semibold">
        {title}
      </h3>
      {children}
    </div>
  );
}

const UPGRADE_STEPS = [
  { title: "Tell us what you need", body: "Contact the FleetFlow team with the plan and billing cycle (monthly or annual) you want." },
  { title: "Pay the invoice", body: "We send an invoice — pay by bKash or bank transfer." },
  { title: "We switch your plan", body: "As soon as payment is confirmed. Your data stays exactly as it is." },
];

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
        <Skeleton className="h-36 w-full rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
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
      {/* ── current plan ── */}
      <section className={PANEL} aria-labelledby="plan-current-title">
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
          <div className="flex min-w-0 items-start gap-4">
            <span
              className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow-[0_8px_20px_-8px_rgb(4_120_87/0.6)]"
              aria-hidden="true"
            >
              <Sparkles className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Current plan</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <h3 id="plan-current-title" className="text-2xl font-semibold tracking-tight">
                  {plan.name}
                </h3>
                {/* skip "Trial · Trial" when the status just repeats the plan name */}
                {sub?.status && (SUBSCRIPTION_LABELS[sub.status] ?? sub.status) !== plan.name && (
                  <Badge variant="outline" className={STATUS_TONE[sub.status] ?? STATUS_TONE.CANCELLED}>
                    {SUBSCRIPTION_LABELS[sub.status] ?? sub.status}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                {sub && agreed != null
                  ? `${formatCyclePrice(agreed, cycle)} · ${CYCLE_LABELS[cycle] ?? cycle} billing`
                  : sub || free
                    ? "Free — nothing to pay"
                    : plan.description}
              </p>
            </div>
          </div>
          {sub && (
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-3 lg:min-w-[30rem]">
              <DetailRow icon={Wallet} label="Your price">
                <span className="tabular-nums">{formatCyclePrice(agreed, cycle)}</span>
                {priceDiffers && (
                  <span className="block text-xs font-normal text-muted-foreground tabular-nums">
                    List price now {list == null ? "not offered on this cycle" : formatCyclePrice(list, cycle)} — you keep your agreed price.
                  </span>
                )}
              </DetailRow>
              <DetailRow icon={CalendarCheck} label="Paid until">
                {sub.paidUntil ? formatDate(sub.paidUntil) : "—"}
              </DetailRow>
              <DetailRow icon={CalendarClock} label="On this plan since">
                {sub.planAssignedAt ? formatDate(sub.planAssignedAt) : "—"}
              </DetailRow>
            </dl>
          )}
        </div>

        {/* features */}
        <div className="border-t px-5 py-4 sm:px-6">
          <ul className="flex flex-wrap gap-2" aria-label="Plan features">
            {FEATURE_KEYS.map((f) => {
              const on = features.includes(f);
              return (
                <li
                  key={f}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                    on
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-dashed text-muted-foreground"
                  )}
                  title={on ? "Included" : "Not included — available on higher plans"}
                >
                  {on ? <Check className="size-3.5" aria-hidden="true" /> : <Lock className="size-3 opacity-70" aria-hidden="true" />}
                  {FEATURES[f].label}
                  <span className="sr-only">{on ? " — included" : " — not included, available on higher plans"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ── usage ── */}
      <section aria-labelledby="plan-usage-title" className="flex flex-col gap-3">
        <SectionHeading id="plan-usage-title" title="Usage">
          <p className="text-xs text-muted-foreground">Deliveries count from the 1st of this month</p>
        </SectionHeading>
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
        <ul className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {RESOURCE_ORDER.map((r) => (
            <UsageTile key={r} label={resourceLabels[r]} used={usage[r]} limit={plan.limits[r]} />
          ))}
        </ul>
        {free && <p className="text-xs text-muted-foreground">You are on a free plan. Pick a plan below when you are ready — there is nothing to pay online.</p>}
      </section>

      {/* ── pricing ── */}
      <section aria-labelledby="plan-pricing-title" className="flex flex-col gap-3">
        <SectionHeading id="plan-pricing-title" title="Proposed pricing">
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">{PROPOSED_PRICING_NOTE}</p>
        </SectionHeading>
        <PlanCards plans={data.plans} resourceLabels={resourceLabels} currentCode={plan.code} />
      </section>

      {/* ── how to upgrade ── */}
      <section className={cn(PANEL, "p-5 sm:p-6")} aria-labelledby="plan-upgrade-title">
        <SectionHeading id="plan-upgrade-title" title="How to upgrade">
          <p className="text-xs text-muted-foreground">There is no online payment yet</p>
        </SectionHeading>
        <ol className="mt-4 grid gap-4 md:grid-cols-3">
          {UPGRADE_STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary tabular-nums ring-1 ring-primary/20 ring-inset"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-5 flex items-start gap-2.5 rounded-xl border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <Mail className="mt-px size-4 shrink-0" aria-hidden="true" />
          {data.billingContact ? (
            <span>
              Invoices are sent to <span className="font-medium text-foreground">{data.billingContact}</span>.
            </span>
          ) : (
            <span>
              No billing email on file —{" "}
              <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => goToSettings("company")}>
                add a contact email
              </button>{" "}
              so invoices reach you.
            </span>
          )}
        </p>
      </section>
    </div>
  );
}
