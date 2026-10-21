"use client";

import { AlertTriangle, Check, CreditCard, Mail } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiData } from "@/lib/api-client";
import { cn } from "@/lib/utils";
// Plan types from the client-safe catalog; live plan/usage values come from /api/billing.
import type { PlanCode, PlanDefinition, PlanResource } from "@/lib/plan-catalog";

// ─────────────────────────────────────────────────────────────
// Plan & usage panel (admin) + shared pricing cards.
// No payment integration: upgrades are handled manually by the
// FleetFlow team (see docs/BILLING.md).
// ─────────────────────────────────────────────────────────────

export interface BillingData {
  plan: Pick<PlanDefinition, "code" | "name" | "proposedPriceBdt" | "limits" | "highlights">;
  usage: Record<PlanResource, number>;
  plans: PlanDefinition[];
  resourceLabels: Record<PlanResource, string>;
  billingContact: string | null;
}

const RESOURCE_ORDER: PlanResource[] = ["monthlyDeliveries", "drivers", "vehicles", "admins"];
const PAID_TIERS: PlanCode[] = ["starter", "growth", "business"];
/** Usage at or above this share of a limit is shown in amber. */
const NEAR_LIMIT = 0.8;

export const PROPOSED_PRICING_NOTE = "Proposed prices in BDT — not final, for discussion";

export function formatBdt(amount: number): string {
  return `৳${amount.toLocaleString("en-US")}`;
}

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

/**
 * The three paid tiers as cards. Pure presentational — used by PlanPanel (data from
 * /api/billing) and by PricingTable (data straight from src/lib/plan-catalog.ts, no session).
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
  const tiers = PAID_TIERS.map((code) => plans.find((p) => p.code === code)).filter((p): p is PlanDefinition => !!p);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 md:grid-cols-3">
        {tiers.map((p) => {
          const current = p.code === currentCode;
          return (
            <div
              key={p.code}
              className={cn(
                "flex flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground",
                current && "border-primary/50 ring-1 ring-primary/30"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-base font-semibold">{p.name}</p>
                {current ? (
                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                    Current plan
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Proposed
                  </Badge>
                )}
              </div>
              <div>
                <p className="text-2xl font-semibold tracking-tight tabular-nums">
                  {p.proposedPriceBdt == null ? "—" : formatBdt(p.proposedPriceBdt)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">/ month</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">proposed price, BDT</p>
              </div>
              <ul className="flex flex-col gap-1.5 text-sm">
                {RESOURCE_ORDER.map((r) => (
                  <li key={r} className="tabular-nums">
                    {limitLine(p.limits[r], resourceLabels[r])}
                  </li>
                ))}
              </ul>
              <ul className="flex flex-col gap-1.5 border-t pt-3 text-sm text-muted-foreground">
                {p.highlights.map((h) => (
                  <li key={h} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{PROPOSED_PRICING_NOTE}. No online payment — plans are changed by the FleetFlow team.</p>
    </div>
  );
}

export function PlanPanel() {
  const { data, error } = useApiData<BillingData>("/api/billing");

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertTitle>Failed to load your plan</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
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
  const overLimits = RESOURCE_ORDER.filter((r) => {
    const s = usageState(usage[r], plan.limits[r]);
    return s === "over" || s === "at";
  });

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
              {plan.proposedPriceBdt != null ? ` · ${formatBdt(plan.proposedPriceBdt)}/mo (proposed)` : ""}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
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
          {plan.code === "trial" && (
            <p className="text-xs text-muted-foreground">You are on the free trial. Pick a plan below when you are ready — there is nothing to pay online.</p>
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
            <li>Contact the FleetFlow team and tell us which plan you want.</li>
            <li>We send a monthly invoice; pay by bKash or bank transfer.</li>
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
