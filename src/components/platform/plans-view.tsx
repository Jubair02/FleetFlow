"use client";

import { Check, Code2, CreditCard, Info } from "lucide-react";
import { RESOURCE_LABELS, type PlanResource } from "@/lib/plan-catalog";
import type { PlatformPlansData } from "@/lib/platform-types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlatformData } from "./platform-api";
import { Callout, EmptyState, ErrorState, fmtNum, formatBdt, PageHeader, PROPOSED_PRICE_NOTE } from "./shared";

const RESOURCE_ORDER: PlanResource[] = ["monthlyDeliveries", "drivers", "vehicles", "admins"];

function limitText(limit: number | null): string {
  return limit === null ? "Unlimited" : fmtNum(limit);
}

export function PlansView() {
  const { data, error, reload } = usePlatformData<PlatformPlansData>("/api/platform/plans");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Plans" description="Subscription tiers and how many organizations are on each." />

      {error && !data ? (
        <ErrorState title="Couldn't load plans" message={error} onRetry={reload} />
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-80 w-full rounded-xl" />
          ))}
        </div>
      ) : data.plans.length === 0 ? (
        <EmptyState icon={CreditCard} title="No plans defined" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.plans.map((p) => (
              <div key={p.code} className="flex flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold">{p.name}</p>
                    <code className="text-[11px] text-muted-foreground">{p.code}</code>
                  </div>
                  <Badge variant="outline" className="tabular-nums">
                    {fmtNum(p.organizationCount)} {p.organizationCount === 1 ? "org" : "orgs"}
                  </Badge>
                </div>
                <div>
                  <p className="text-2xl font-semibold tracking-tight tabular-nums">
                    {p.proposedPriceBdt == null ? "Free" : formatBdt(p.proposedPriceBdt)}
                    {p.proposedPriceBdt != null && <span className="ml-1 text-sm font-normal text-muted-foreground">/ month</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.proposedPriceBdt == null ? "not sold — evaluation only" : "proposed price, BDT"}</p>
                </div>
                <dl className="flex flex-col gap-1.5 text-sm">
                  {RESOURCE_ORDER.map((r) => (
                    <div key={r} className="flex justify-between gap-2">
                      <dt className="text-muted-foreground first-letter:uppercase">{RESOURCE_LABELS[r].replace("this month", "per month")}</dt>
                      <dd className="shrink-0 tabular-nums">{limitText(p.limits[r])}</dd>
                    </div>
                  ))}
                </dl>
                <ul className="flex flex-col gap-1.5 border-t pt-3 text-sm text-muted-foreground">
                  {p.highlights.map((h) => (
                    <li key={h} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{PROPOSED_PRICE_NOTE}.</p>
          {data.unknownPlanCount > 0 && (
            <Callout>
              {fmtNum(data.unknownPlanCount)} {data.unknownPlanCount === 1 ? "organization has" : "organizations have"} a plan code that isn&apos;t in the
              catalog. They are treated as Trial — set a valid plan from the organization panel.
            </Callout>
          )}
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Code2 className="size-4 text-muted-foreground" aria-hidden /> Where plans are defined
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-4 text-sm text-muted-foreground">
            <p>
              Plans, limits and proposed prices live in code in <code className="rounded bg-muted px-1 text-xs">src/lib/plan-catalog.ts</code>. They can&apos;t be
              edited here — changes ship with a deploy and apply to every organization on that plan.
            </p>
            <p>Limits are only checked when something is added. Lowering a limit never removes or disables existing data.</p>
          </CardContent>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Info className="size-4 text-muted-foreground" aria-hidden /> How billing works today
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-4 text-sm text-muted-foreground">
            <p>There is no payment gateway. Billing is manual:</p>
            <ol className="ml-4 list-decimal space-y-1">
              <li>Agree the plan with the customer and invoice them outside FleetFlow.</li>
              <li>Once paid, change the plan and record the subscription status, paid-until date and notes on the organization.</li>
              <li>If payment lapses, mark the subscription Past due; suspend only as a last resort.</li>
            </ol>
            <p>
              Full process: <code className="rounded bg-muted px-1 text-xs">docs/BILLING.md</code>.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
