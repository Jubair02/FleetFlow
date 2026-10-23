"use client";

import { CreditCard, Pencil } from "lucide-react";
import { formatDate } from "@/lib/format";
import { RESOURCE_LABELS } from "@/lib/plan-catalog";
import type { PlatformOrgDetail } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BILLING_CYCLE_LABELS, Callout, fmtNum, formatPrice, SubscriptionBadge } from "../../shared";
import { PlanPill } from "../org-parts";
import { FeatureList, RESOURCE_ORDER } from "./org-form-dialog";
import { DetailList, DetailRow, SectionTitle } from "./overview-tab";
import { renewalLabel } from "./org-dialog-utils";

export function SubscriptionTab({
  detail,
  onChangePlan,
  onEditSubscription,
}: {
  detail: PlatformOrgDetail;
  onChangePlan: () => void;
  onEditSubscription: () => void;
}) {
  const org = detail.organization;
  const plan = detail.planDetail;
  // A plan with no list price on either cycle is free; otherwise a null list price means "not offered on this cycle".
  const listOffered = plan.monthlyPriceBdt != null || plan.annualPriceBdt != null;
  const grandfathered = (org.subscriptionPriceBdt ?? null) !== (detail.currentListPriceBdt ?? null);
  const renewal = renewalLabel(org.paidUntil, org.subscriptionStatus, new Date(), formatDate);
  const ended = renewal?.startsWith("Ended");

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Current subscription" className="flex flex-col gap-4 rounded-xl border bg-gradient-to-br from-primary/[0.06] to-transparent p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PlanPill code={plan.code} name={plan.name} inactive={!plan.active} />
            <SubscriptionBadge status={org.subscriptionStatus} />
            {grandfathered && (
              <span
                className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
                title="The agreed price differs from the plan's current list price"
              >
                Grandfathered
              </span>
            )}
          </div>
          <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{formatPrice(org.subscriptionPriceBdt, org.billingCycle)}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Agreed price · billed {BILLING_CYCLE_LABELS[org.billingCycle].toLowerCase()}
            {grandfathered && (
              <>
                {" "}
                · list price{" "}
                {detail.currentListPriceBdt == null && listOffered
                  ? `not offered ${org.billingCycle === "ANNUAL" ? "annually" : "monthly"}`
                  : formatPrice(detail.currentListPriceBdt, org.billingCycle)}
              </>
            )}
          </div>
          {renewal && <div className={ended ? "mt-1 text-xs font-medium text-amber-700 dark:text-amber-400" : "mt-1 text-xs text-muted-foreground"}>{renewal}</div>}
        </div>
        <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row">
          <Button className="h-11 sm:h-9" onClick={onChangePlan}>
            <CreditCard aria-hidden /> Change plan
          </Button>
          <Button variant="outline" className="h-11 sm:h-9" onClick={onEditSubscription}>
            <Pencil aria-hidden /> Edit subscription
          </Button>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2 md:gap-8">
        <section>
          <SectionTitle>Subscription record</SectionTitle>
          <DetailList>
            <DetailRow label="Status">{<SubscriptionBadge status={org.subscriptionStatus} />}</DetailRow>
            <DetailRow label="Paid until">{org.paidUntil ? formatDate(org.paidUntil) : <span className="text-muted-foreground">—</span>}</DetailRow>
            <DetailRow label="Plan assigned">{formatDate(org.planAssignedAt)}</DetailRow>
            <DetailRow label="Billing cycle">{BILLING_CYCLE_LABELS[org.billingCycle]}</DetailRow>
            <DetailRow label="Billing notes">
              <span className="whitespace-pre-wrap">{org.billingNotes || <span className="text-muted-foreground">—</span>}</span>
            </DetailRow>
          </DetailList>
          <p className="mt-2 text-[11px] text-muted-foreground">Recorded manually — no payment is processed by FleetFlow.</p>
        </section>
        <section className="flex flex-col gap-6">
          <div>
            <SectionTitle>Plan limits</SectionTitle>
            <DetailList>
              {RESOURCE_ORDER.map((r) => (
                <DetailRow key={r} label={RESOURCE_LABELS[r].replace(/^./, (c) => c.toUpperCase())}>
                  <span className="tabular-nums">{plan.limits[r] === null ? "Unlimited" : fmtNum(plan.limits[r])}</span>
                </DetailRow>
              ))}
            </DetailList>
          </div>
          <div>
            <SectionTitle>Features</SectionTitle>
            <FeatureList features={plan.features} />
          </div>
        </section>
      </div>

      {!plan.active && (
        <Callout tone="zinc">{plan.name} is inactive — this organization keeps it, but it can&apos;t be assigned to anyone new.</Callout>
      )}
    </div>
  );
}

export function SubscriptionSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading subscription">
      <Skeleton className="h-32 w-full rounded-xl" />
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}
