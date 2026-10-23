"use client";

import { useState } from "react";
import { ArrowDown, ArrowRight, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { FEATURE_KEYS, FEATURES, listPrice, planHasFeature, RESOURCE_LABELS, type BillingCycle, type PlanCode } from "@/lib/plan-catalog";
import type { PlatformOrgDetail, PlatformPlansData } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlatformData } from "../../platform-api";
import { BILLING_CYCLE_LABELS, Callout, ErrorState, errorProps, FieldError, fmtNum, formatPrice, ServerError } from "../../shared";
import { patchOrg } from "../org-api";
import { PlanPill } from "../org-parts";
import { OrgFormDialog, RESOURCE_ORDER, type FormControls } from "./org-form-dialog";

const CYCLES: BillingCycle[] = ["MONTHLY", "ANNUAL"];
const PRICE_MAX = 10_000_000;

const priceToField = (price: number | null) => (price == null ? "" : String(price));

/** Change plan, billing cycle and agreed price (existing "set-plan" action and rules). */
export function ChangePlanDialog({
  open,
  onOpenChange,
  orgId,
  detail,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgId: string | null;
  detail?: PlatformOrgDetail | null;
}) {
  return (
    <OrgFormDialog open={open} onOpenChange={onOpenChange} orgId={orgId} detail={detail} title="Change plan" className="sm:max-w-xl">
      {(d, controls) => <ChangePlanForm detail={d} controls={controls} />}
    </OrgFormDialog>
  );
}

function ChangePlanForm({ detail, controls }: { detail: PlatformOrgDetail; controls: FormControls }) {
  const org = detail.organization;
  const current = detail.planDetail;
  const { data: plansData, error: plansError, reload: reloadPlans } = usePlatformData<PlatformPlansData>("/api/platform/plans");
  // Active plans can be assigned; the current plan is always listed (even if inactive) so the select can show it.
  const options = (plansData?.plans ?? []).filter((p) => p.active || p.code === current.code);
  if (!options.some((p) => p.code === current.code)) options.unshift({ ...current, organizationCount: 0, grandfatheredCount: 0 });

  const [plan, setPlan] = useState<PlanCode>(current.code);
  const [cycle, setCycle] = useState<BillingCycle>(org.billingCycle);
  const [price, setPrice] = useState(priceToField(org.subscriptionPriceBdt));
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const next = options.find((p) => p.code === plan) ?? current;
  const nextList = listPrice(next, cycle);

  /** Re-prefill the price with the list price whenever the plan or cycle changes. */
  const choose = (nextPlan: PlanCode, nextCycle: BillingCycle) => {
    setPlan(nextPlan);
    setCycle(nextCycle);
    const p = options.find((o) => o.code === nextPlan) ?? current;
    setPrice(priceToField(listPrice(p, nextCycle)));
  };

  const trimmed = price.trim().replace(/,/g, "");
  const parsed = trimmed === "" ? null : Number(trimmed);
  const priceError =
    parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > PRICE_MAX)
      ? `Enter a whole number of taka (0–${PRICE_MAX.toLocaleString("en-US")}), or leave it empty for free`
      : undefined;
  const negotiated = parsed !== (nextList ?? null);
  const unchanged = plan === current.code && cycle === org.billingCycle && parsed === (org.subscriptionPriceBdt ?? null);
  const planChanged = plan !== current.code;

  const overLimits = RESOURCE_ORDER.filter((r) => {
    const limit = next.limits[r];
    return limit !== null && (detail.usage[r] ?? 0) > limit;
  });
  const lostFeatures = FEATURE_KEYS.filter((f) => planHasFeature(current, f) && !planHasFeature(next, f));
  const canSubmit = !!plansData && next.active && !priceError && !unchanged && !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    controls.setBusy(true);
    setServerError(null);
    try {
      await patchOrg(org.id, {
        action: "set-plan",
        plan,
        billingCycle: cycle,
        // Omitted = snapshot the list price; a number (or null = free) records a negotiated price.
        ...(negotiated ? { priceBdt: parsed } : {}),
      });
      toast.success(planChanged ? `${org.name} moved to ${next.name}` : `${org.name}: subscription updated`);
      controls.setBusy(false);
      controls.close();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not change the plan");
      controls.setBusy(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>Change plan</DialogTitle>
        <DialogDescription>{org.name}</DialogDescription>
      </DialogHeader>

      {plansError && !plansData ? (
        <ErrorState title="Couldn't load plans" message={plansError} onRetry={reloadPlans} />
      ) : !plansData ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <span />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <>
          <div className="grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr] sm:gap-3">
            <section aria-label="Current plan" className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-4">
              <span className="text-xs font-medium text-muted-foreground">Current plan</span>
              <PlanPill code={current.code} name={current.name} inactive={!current.active} />
              <div>
                <div className="text-lg font-semibold tabular-nums">{formatPrice(org.subscriptionPriceBdt, org.billingCycle)}</div>
                <div className="text-xs text-muted-foreground">Agreed price · {BILLING_CYCLE_LABELS[org.billingCycle]}</div>
              </div>
            </section>
            <div className="flex items-center justify-center text-muted-foreground" aria-hidden>
              <ArrowDown className="size-5 sm:hidden" />
              <ArrowRight className="hidden size-5 sm:block" />
            </div>
            <section aria-label="New plan" className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/[0.04] p-4">
              <Label htmlFor="plan-select" className="text-xs font-medium text-muted-foreground">
                New plan
              </Label>
              <Select value={plan} onValueChange={(v) => choose(v, cycle)} disabled={submitting}>
                <SelectTrigger id="plan-select" className="h-11 w-full bg-background sm:h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.name}
                      {p.code === current.code ? " · current" : ""}
                      {!p.active ? " · inactive" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">
                List price: {nextList == null ? `none ${cycle === "ANNUAL" ? "annually" : "monthly"}` : formatPrice(nextList, cycle)}
              </div>
            </section>
          </div>

          {!next.active ? (
            <Callout tone="zinc">
              {next.name} is inactive, so it can&apos;t be assigned again — not even to change the cycle or price. The organization keeps it until you move it
              to an active plan.
            </Callout>
          ) : (
            <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="cycle-select">Billing cycle</Label>
                <Select value={cycle} onValueChange={(v) => choose(plan, v as BillingCycle)} disabled={submitting}>
                  <SelectTrigger id="cycle-select" className="h-11 w-full sm:h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CYCLES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {BILLING_CYCLE_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-price">
                  Price per {cycle === "ANNUAL" ? "year" : "month"} <span className="font-normal text-muted-foreground">(BDT)</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="plan-price"
                    inputMode="numeric"
                    className="h-11 sm:h-9"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="Free"
                    maxLength={12}
                    disabled={submitting}
                    {...errorProps("plan-price", priceError)}
                  />
                  {negotiated && (
                    <Button type="button" variant="ghost" className="h-11 shrink-0 sm:h-9" onClick={() => choose(plan, cycle)} disabled={submitting}>
                      Use list price
                    </Button>
                  )}
                </div>
                <FieldError id="plan-price-error" message={priceError} />
                <p className="text-[11px] text-muted-foreground">
                  {negotiated && !priceError ? "Recording a negotiated price. " : "Prefilled with the list price. "}Leave empty for free.
                </p>
              </div>
            </div>
          )}

          {planChanged && (
            <ul className="divide-y rounded-lg border text-xs" aria-label={`Limits: ${current.name} compared with ${next.name}`}>
              {RESOURCE_ORDER.map((r) => {
                const over = overLimits.includes(r);
                return (
                  <li key={r} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="first-letter:uppercase">{RESOURCE_LABELS[r]}</span>
                    <span className="flex items-center gap-1.5 tabular-nums text-muted-foreground">
                      <span>{fmtNum(detail.usage[r] ?? 0)} in use ·</span>
                      <span>{current.limits[r] ?? "∞"}</span>
                      <ArrowRight className="size-3" aria-label="to" />
                      <span className={over ? "font-semibold text-rose-600 dark:text-rose-400" : "font-medium text-foreground"}>
                        {next.limits[r] ?? "∞"}
                        {over && <span className="sr-only"> (usage is over this limit)</span>}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {overLimits.length > 0 && (
            <Callout>
              Usage is above the {next.name} limit for {overLimits.map((r) => RESOURCE_LABELS[r]).join(", ")}. Nothing is removed, but the company can&apos;t
              add more of these until usage drops or the plan is raised.
            </Callout>
          )}
          {lostFeatures.length > 0 && (
            <Callout>
              {next.name} doesn&apos;t include {lostFeatures.map((f) => FEATURES[f].label.toLowerCase()).join(", ")}. The company loses access straight away;
              existing data is kept.
            </Callout>
          )}
        </>
      )}

      <Callout tone="zinc">
        Takes effect immediately. Limits apply to new additions only; existing data is kept. Recorded manually — no payment is processed.
      </Callout>
      <ServerError message={serverError} />
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={controls.close} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 sm:h-9" disabled={!canSubmit}>
          {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
          {planChanged ? "Change plan" : "Save subscription"}
        </Button>
      </DialogFooter>
    </form>
  );
}
