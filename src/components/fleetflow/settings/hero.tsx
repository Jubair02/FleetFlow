"use client";

import type { ReactNode } from "react";
import { format } from "date-fns";
import { Building2, Sparkles, type LucideIcon } from "lucide-react";

import { ENTER_MOTION } from "@/components/fleetflow/driver/job-utils";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SettingsTab } from "@/store/app-store";

export interface SettingsNavItem {
  value: SettingsTab;
  label: string;
  icon: LucideIcon;
  /** Live one-liner under the label (hidden on phones); null while loading. */
  summary: string | null;
}

/** Same emerald surface as the dashboard / dispatch heroes. */
function HeroSurface({ children }: { children: ReactNode }) {
  return (
    <section
      aria-labelledby="settings-title"
      className={cn(
        "relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600 p-4 text-white sm:p-6",
        "shadow-[0_1px_2px_rgb(0_0_0/0.06),0_12px_32px_-16px_rgb(4_120_87/0.6)] dark:from-emerald-950 dark:via-emerald-900 dark:to-teal-900 dark:shadow-none dark:ring-1 dark:ring-white/10",
        ENTER_MOTION,
      )}
    >
      {/* light-mode scrim: lifts white small text to ≥4.5:1 on the emerald-600 / teal-600 stops */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-black/15 dark:hidden" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_80%_at_100%_0%,rgb(255_255_255/0.18),transparent_55%)]"
        aria-hidden="true"
      />
      {children}
    </section>
  );
}

/**
 * Settings header. Its tiles ARE the tab list (Radix tabs: arrow keys move
 * between them), each showing a live summary of that section.
 */
export function SettingsHero({
  orgName,
  since,
  planName,
  items,
}: {
  orgName: string | null;
  since: string | null;
  planName: string | null;
  items: SettingsNavItem[];
}) {
  return (
    <HeroSurface>
      <div className="flex items-start gap-4">
        <span
          className="hidden size-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-lg font-semibold ring-1 ring-inset ring-white/25 sm:flex"
          aria-hidden="true"
        >
          {orgName ? initials(orgName) : <Building2 className="size-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white/90">Workspace settings</p>
          <h2 id="settings-title" className="mt-0.5 truncate text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
            {orgName ?? "Settings"}
          </h2>
          <p className="mt-1 text-sm text-pretty text-white/90">
            Company profile, team access and your subscription
            {since ? <span className="hidden sm:inline"> · with FleetFlow since {format(new Date(since), "MMMM yyyy")}</span> : null}
          </p>
        </div>
        {planName && (
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-inset ring-white/25 md:inline-flex">
            <Sparkles className="size-3.5" aria-hidden="true" /> {planName} plan
          </span>
        )}
      </div>

      <TabsList aria-label="Settings sections" className="mt-5 grid h-auto w-full grid-cols-3 items-stretch gap-2 bg-transparent p-0 text-white sm:gap-3">
        {items.map(({ value, label, icon: Icon, summary }) => (
          <TabsTrigger
            key={value}
            value={value}
            className={cn(
              "group h-auto min-w-0 flex-col items-start justify-start gap-2 rounded-2xl border-0 px-3 py-3 text-left whitespace-normal sm:px-4",
              "bg-emerald-950/25 text-white ring-1 ring-white/15 ring-inset hover:bg-emerald-950/35 dark:bg-white/5 dark:text-white dark:hover:bg-white/10",
              "transition-[background-color,color,box-shadow,transform] duration-200 motion-safe:active:scale-[0.98]",
              "focus-visible:ring-[3px] focus-visible:ring-white/70 focus-visible:outline-none",
              "data-[state=active]:bg-white data-[state=active]:text-emerald-950 data-[state=active]:shadow-[0_10px_30px_-12px_rgb(0_0_0/0.45)] data-[state=active]:ring-white",
              "dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-white dark:data-[state=active]:text-emerald-950",
            )}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="flex size-8 items-center justify-center rounded-xl bg-white/15 transition-colors group-data-[state=active]:bg-emerald-600 group-data-[state=active]:text-white">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span
                className="size-1.5 rounded-full bg-emerald-500 opacity-0 transition-opacity group-data-[state=active]:opacity-100"
                aria-hidden="true"
              />
            </span>
            <span className="w-full text-sm leading-tight font-semibold">{label}</span>
            <span className="hidden w-full truncate text-xs font-normal text-white/80 group-data-[state=active]:text-emerald-800 sm:block dark:group-data-[state=active]:text-emerald-800">
              {summary ?? "Loading…"}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </HeroSurface>
  );
}
