"use client";

import type { ReactNode } from "react";
import { RefreshCw, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── form helpers ─────────────────────────────────────────────

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-rose-600 dark:text-rose-400">
      {message}
    </p>
  );
}

export function ServerError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
      role="alert"
    >
      {message}
    </p>
  );
}

export function errorProps(id: string, message?: string) {
  return message ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};
}

export function issuesByField<K extends string>(issues: { path: PropertyKey[]; message: string }[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const issue of issues) {
    const key = issue.path[0] as K;
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

// ── surfaces ─────────────────────────────────────────────────

/** Settings card: soft border, generous radius. No overflow clipping, so sticky footers keep working. */
export const PANEL = "rounded-2xl border bg-card text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04)]";

export function LoadError({ what, error, onRetry }: { what: string; error: string; onRetry: () => void }) {
  return (
    <div className={cn(PANEL, "flex flex-col items-start gap-3 p-6")}>
      <p className="text-sm text-destructive">
        Failed to load {what}: {error}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw aria-hidden /> Try again
      </Button>
    </div>
  );
}

/** Rounded icon chip used by section headings. */
export function IconChip({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15", className)}
      aria-hidden="true"
    >
      <Icon className="size-4" />
    </span>
  );
}

/** Label column on the left (md+), fields on the right — stacked on phones. */
export function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:gap-8">
      <div className="flex items-start gap-3">
        <IconChip icon={icon} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="grid min-w-0 content-start gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Puts a muted icon inside an Input/Textarea (give the control `pl-9`). */
export function WithIcon({ icon: Icon, multiline, children }: { icon: LucideIcon; multiline?: boolean; children: ReactNode }) {
  return (
    <div className="relative">
      <Icon
        className={cn("pointer-events-none absolute left-3 size-4 text-muted-foreground", multiline ? "top-2.5" : "top-1/2 -translate-y-1/2")}
        aria-hidden="true"
      />
      {children}
    </div>
  );
}
