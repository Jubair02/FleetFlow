"use client";

import { useState } from "react";
import { AlertTriangle, Clock, Lock, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { goToSettings } from "@/store/app-store";
import type { SubscriptionAccess } from "@/lib/subscription";

const TONE = {
  ENDING_SOON: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
  GRACE: "border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100",
  READ_ONLY: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200",
} as const;

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Trial / subscription status for staff. Server-side enforcement lives in
 * src/lib/plans.ts; this only explains it. "Ending soon" can be dismissed
 * for the session; grace and read-only can't.
 */
export function SubscriptionBanner({ access, canManagePlan }: { access: SubscriptionAccess; canManagePlan: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  if (access.state === "OK" || (access.state === "ENDING_SOON" && dismissed)) return null;

  const what = access.kind === "TRIAL" ? "trial" : "subscription";
  const ends = access.endsAt ? formatDate(access.endsAt) : "";
  const readOnlyOn = access.readOnlyAt ? formatDate(access.readOnlyAt) : "";
  const contact = canManagePlan ? "Pay or request an invoice in Plan & billing" : "Ask your admin to renew in Plan & billing";

  const { Icon, title, body } =
    access.state === "ENDING_SOON"
      ? {
          Icon: Clock,
          title: `Your ${what} ends in ${plural(access.daysLeft, "day")}`,
          body: `It ends on ${ends}. ${contact} to keep adding deliveries without interruption.`,
        }
      : access.state === "GRACE"
        ? {
            Icon: AlertTriangle,
            title: `Your ${what} has ended — ${plural(access.daysLeft, "day")} left before read-only`,
            body: `Everything still works until ${readOnlyOn}. After that you can view and finish deliveries already under way, but not add new ones. ${contact}.`,
          }
        : {
            Icon: Lock,
            title: "Your account is read-only",
            body: `Your ${what} ended on ${ends}. You can still view, export and complete deliveries already under way, but you can't create, import or assign new ones. ${contact}.`,
          };

  return (
    <div role={access.state === "ENDING_SOON" ? "status" : "alert"} className={cn("mb-5 flex items-start gap-3 rounded-2xl border px-4 py-3", TONE[access.state])}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-pretty opacity-90">{body}</p>
        {canManagePlan && (
          <Button variant="link" className="mt-1 h-auto p-0 text-sm font-semibold text-current underline" onClick={() => goToSettings("plan")}>
            Plans, invoices &amp; payment →
          </Button>
        )}
      </div>
      {access.state === "ENDING_SOON" && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="-m-1 rounded-md p-1 opacity-70 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-label="Dismiss"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
