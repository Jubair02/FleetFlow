"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { PlanCards } from "@/components/fleetflow/plan-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiData } from "@/lib/api-client";
import { RESOURCE_LABELS, type PlanDefinition } from "@/lib/plan-catalog";

/**
 * Public pricing: active, public plans with limits, prices and highlights,
 * labelled as proposed. Needs no session — data comes from the public GET /api/plans.
 */
export function PricingTable() {
  const { data, error, reload } = useApiData<{ plans: PlanDefinition[] }>("/api/plans");

  if (error && !data) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-5 text-sm sm:flex-row sm:items-center">
        <AlertTriangle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <p className="flex-1 text-muted-foreground">Pricing couldn&apos;t be loaded right now. You can still create your account — plans are set up with the FleetFlow team.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
          <RotateCw aria-hidden="true" /> Retry
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-3" aria-busy="true" aria-label="Loading plans">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-4 rounded-xl border bg-card p-5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-8 w-32" />
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-4 w-full" />
              ))}
            </div>
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    );
  }

  const signupPlan = data.plans.find((p) => p.isDefault);
  return (
    <div className="flex flex-col gap-3">
      {signupPlan && (
        <p className="text-sm text-muted-foreground">
          New companies start on <span className="font-medium text-foreground">{signupPlan.name}</span>.
        </p>
      )}
      <PlanCards plans={data.plans} resourceLabels={RESOURCE_LABELS} />
    </div>
  );
}
