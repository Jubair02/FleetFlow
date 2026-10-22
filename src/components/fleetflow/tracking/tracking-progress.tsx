"use client";

import { AlertCircle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrackingData } from "@/lib/types";
import { computeSteps, stepTime, type StepState } from "./tracking-model";
import { ENTER, Surface } from "./tracking-ui";

/** Connector colour leading INTO a step. */
function connector(step: StepState): string {
  if (!step.reached) return "bg-border dark:bg-white/10";
  if (step.neutral) return "bg-slate-300 dark:bg-slate-600";
  if (step.failed) return "bg-amber-500";
  return "bg-emerald-500";
}

function StepDot({ step, index }: { step: StepState; index: number }) {
  return (
    <span
      className={cn(
        "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
        step.failed
          ? "bg-amber-600 text-white ring-4 ring-amber-500/20"
          : step.current
            ? "bg-emerald-600 text-white ring-4 ring-emerald-500/20"
            : step.neutral
              ? "bg-slate-400 text-white dark:bg-slate-600"
              : step.reached
                ? "bg-emerald-600 text-white"
                : "bg-card text-muted-foreground ring-1 ring-border ring-inset dark:ring-white/15",
      )}
      aria-hidden="true"
    >
      {step.current && !step.failed ? (
        <span className="absolute inset-0 rounded-full ring-2 ring-emerald-500/50 motion-safe:animate-[pulse_2.4s_ease-in-out_infinite]" />
      ) : null}
      {step.failed ? (
        <AlertCircle className="size-4" />
      ) : step.current ? (
        <span className="size-2.5 rounded-full bg-white" />
      ) : step.reached ? (
        <Check className="size-4" strokeWidth={2.5} />
      ) : (
        index + 1
      )}
    </span>
  );
}

function srState(step: StepState): string {
  if (step.failed) return "attempt unsuccessful";
  if (step.current) return "current step";
  if (step.reached) return "completed";
  return "not yet";
}

export function TrackingProgress({ data, now }: { data: TrackingData; now: number }) {
  const steps = computeSteps(data);
  const last = steps.length - 1;
  const reachedCount = steps.filter((s) => s.reached).length;

  return (
    <Surface aria-labelledby="tracking-progress" className={cn("p-5 sm:p-6", ENTER)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="tracking-progress" className="text-sm font-semibold">
          Delivery progress
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {data.status === "CANCELLED" ? "Cancelled" : `${reachedCount} of ${steps.length}`}
        </span>
      </div>

      {/* Phones: vertical stepper with timestamps */}
      <ol className="mt-5 sm:hidden">
        {steps.map((step, i) => (
          <li key={step.status} className="flex gap-3.5" aria-current={step.current ? "step" : undefined}>
            <div className="flex flex-col items-center">
              <StepDot step={step} index={i} />
              {i < last ? <span className={cn("my-1 min-h-5 w-0.5 flex-1 rounded-full", connector(steps[i + 1]))} aria-hidden="true" /> : null}
            </div>
            <div className={cn("min-w-0 pt-1.5", i < last && "pb-4")}>
              <p className={cn("text-sm leading-5", step.reached ? "font-medium text-foreground" : "text-muted-foreground", step.current && "font-semibold")}>
                {step.label}
                <span className="sr-only">, {srState(step)}</span>
              </p>
              {step.failed ? <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Attempt unsuccessful</p> : null}
              {step.at ? (
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  <time dateTime={step.at}>{stepTime(step.at, now)}</time>
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      {/* sm+: horizontal stepper, every label visible, evenly spaced */}
      <ol className="mt-6 hidden grid-cols-5 sm:grid">
        {steps.map((step, i) => (
          <li key={step.status} className="relative flex flex-col items-center px-1 text-center" aria-current={step.current ? "step" : undefined}>
            {i > 0 ? <span className={cn("absolute top-4 right-1/2 left-0 h-0.5 -translate-y-1/2", connector(step))} aria-hidden="true" /> : null}
            {i < last ? (
              <span className={cn("absolute top-4 right-0 left-1/2 h-0.5 -translate-y-1/2", connector(steps[i + 1]))} aria-hidden="true" />
            ) : null}
            <StepDot step={step} index={i} />
            <p
              className={cn(
                "mt-2.5 text-xs leading-tight text-balance md:text-[13px]",
                step.reached ? "font-medium text-foreground" : "text-muted-foreground",
                step.current && "font-semibold",
              )}
            >
              {step.label}
              <span className="sr-only">, {srState(step)}</span>
            </p>
            {step.failed ? <p className="mt-0.5 text-[11px] leading-tight font-medium text-amber-700 dark:text-amber-400">Attempt unsuccessful</p> : null}
            {step.at ? (
              <p className="mt-1 text-[11px] leading-tight text-muted-foreground tabular-nums">
                <time dateTime={step.at}>{stepTime(step.at, now)}</time>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </Surface>
  );
}
