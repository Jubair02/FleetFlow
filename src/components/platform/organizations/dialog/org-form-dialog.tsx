"use client";

import { useState } from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { FEATURE_KEYS, FEATURES, type PlanResource } from "@/lib/plan-catalog";
import type { PlatformOrgDetail } from "@/lib/platform-types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlatformData } from "../../platform-api";
import { ErrorState } from "../../shared";
import { orgUrl } from "../org-api";
import { SHEET_ON_PHONE } from "./org-dialog-utils";

export const RESOURCE_ORDER: PlanResource[] = ["monthlyDeliveries", "drivers", "vehicles", "admins"];

export interface FormControls {
  close: () => void;
  /** While true the dialog can't be dismissed (a request is in flight). */
  setBusy: (busy: boolean) => void;
}

/**
 * Dialog shell for an organization form. Uses `detail` when the caller already
 * has it (organization dialog); otherwise loads it (list ⋮ menu). The form is
 * only mounted once the detail is available, so it can seed its state from it.
 * Mount with a fresh `key` per open.
 */
export function OrgFormDialog({
  open,
  onOpenChange,
  orgId,
  detail,
  title,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  detail?: PlatformOrgDetail | null;
  /** Accessible title while loading / on error. */
  title: string;
  className?: string;
  children: (detail: PlatformOrgDetail, controls: FormControls) => React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = usePlatformData<PlatformOrgDetail>(open && !detail && orgId ? orgUrl(orgId) : null);
  const d = detail ?? data;
  return (
    <Dialog open={open && orgId !== null} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className={cn(SHEET_ON_PHONE, className)}>
        {d ? (
          children(d, { close: () => onOpenChange(false), setBusy })
        ) : error ? (
          <div className="flex flex-col gap-4">
            <DialogTitle>{title}</DialogTitle>
            <ErrorState title="Couldn't load this organization" message={error} onRetry={reload} />
          </div>
        ) : (
          <div className="flex flex-col gap-4" aria-busy="true">
            <DialogTitle className="sr-only">{title}</DialogTitle>
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** ✓ / – list of every catalog feature for a plan. */
export function FeatureList({ features, className }: { features: string[]; className?: string }) {
  return (
    <ul className={cn("flex flex-col gap-1.5 text-sm", className)}>
      {FEATURE_KEYS.map((f) => {
        const on = features.includes(f);
        return (
          <li key={f} className={on ? "flex items-center gap-2" : "flex items-center gap-2 text-muted-foreground"}>
            {on ? (
              <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            ) : (
              <Minus className="size-4 shrink-0 opacity-60" aria-hidden />
            )}
            <span>{FEATURES[f].label}</span>
            <span className="sr-only">{on ? "(included)" : "(not included)"}</span>
          </li>
        );
      })}
    </ul>
  );
}
