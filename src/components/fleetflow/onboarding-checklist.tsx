"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, Circle, FileUp, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { api, useApiData } from "@/lib/api-client";
import { onboardingProgress } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { goToDeliveriesAction, goToSettings, useAppStore } from "@/store/app-store";
import type { OnboardingData, OnboardingStep, OnboardingStepKey } from "@/lib/types-org";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CARD_SURFACE, ENTER_MOTION } from "@/components/fleetflow/driver/job-utils";

interface StepAction {
  label: string;
  icon?: typeof Plus;
  run: () => void;
}

function actionsFor(key: OnboardingStepKey): StepAction[] {
  const setView = useAppStore.getState().setView;
  switch (key) {
    case "company":
      return [{ label: "Open company settings", run: () => goToSettings("company") }];
    case "vehicle":
      return [{ label: "Add a vehicle", icon: Plus, run: () => setView("vehicles") }];
    case "driver":
      return [{ label: "Add a driver", icon: Plus, run: () => setView("drivers") }];
    case "delivery":
      return [
        { label: "Create a delivery", icon: Plus, run: () => goToDeliveriesAction("create") },
        { label: "Import from CSV", icon: FileUp, run: () => goToDeliveriesAction("import") },
      ];
    case "assign":
      return [{ label: "Open dispatch board", run: () => setView("dispatch") }];
    case "team":
      return [{ label: "Invite a dispatcher", icon: Plus, run: () => goToSettings("team") }];
  }
}

function StepRow({ step, index, current }: { step: OnboardingStep; index: number; current: boolean }) {
  const actions = actionsFor(step.key);
  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center",
        current ? "border-primary/40 bg-primary/5" : "bg-card",
        step.done && "opacity-70"
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {step.done ? (
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Done" />
        ) : (
          <span
            className={cn(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
              current ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"
            )}
            aria-hidden
          >
            {step.optional ? <Circle className="size-2.5" /> : index + 1}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("text-sm font-medium", step.done && "line-through decoration-muted-foreground/60")}>{step.label}</span>
            {step.optional && !step.done && (
              <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                Optional
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
        </div>
      </div>
      {!step.done && (
        <div className="flex shrink-0 flex-wrap gap-2 pl-8 sm:pl-0">
          {actions.map((a, i) => {
            const Icon = a.icon ?? ArrowRight;
            return (
              <Button
                key={a.label}
                size="sm"
                variant={current && i === 0 ? "default" : "outline"}
                onClick={a.run}
                className="min-h-11 sm:min-h-8"
              >
                {a.icon && <Icon aria-hidden />}
                {a.label}
                {!a.icon && <Icon aria-hidden />}
              </Button>
            );
          })}
        </div>
      )}
    </li>
  );
}

/** Getting-started checklist shown on the dashboard until it's done or dismissed: a slim progress strip that expands to every step. */
export function OnboardingChecklist() {
  const { data, reload } = useApiData<OnboardingData>("/api/onboarding");
  const [hiding, setHiding] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!data || data.dismissed || data.allDone) return null;

  const progress = onboardingProgress(data);
  const current = data.steps.find((s) => !s.done && !s.optional) ?? data.steps.find((s) => !s.done);
  const currentKey = current?.key;
  const next = current ? actionsFor(current.key)[0] : null;

  const dismiss = async () => {
    setHiding(true);
    try {
      await api.post("/api/onboarding", { dismissed: true });
      toast.success("Checklist hidden. You can bring it back from Settings → Company.");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not hide the checklist");
    } finally {
      setHiding(false);
    }
  };

  return (
    <section
      aria-labelledby="onboarding-title"
      className={cn(CARD_SURFACE, "p-3 sm:p-4", ENTER_MOTION)}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold tabular-nums text-primary ring-1 ring-inset ring-primary/15"
            aria-hidden
          >
            {progress.done}/{progress.total}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="onboarding-title" className="text-sm font-semibold">
              Setup {progress.done} of {progress.total}
              {current ? <span className="font-normal text-muted-foreground"> · Next: {current.label}</span> : null}
            </h2>
            <Progress
              value={progress.percent}
              aria-label={`${progress.done} of ${progress.total} setup steps done`}
              className="mt-1.5 h-1.5 max-w-xs"
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {next ? (
            <Button
              size="sm"
              onClick={next.run}
              className="min-h-11 flex-1 rounded-xl font-semibold transition-transform duration-150 motion-safe:active:scale-[0.98] sm:min-h-9 sm:flex-none"
            >
              Continue <ArrowRight aria-hidden />
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls="onboarding-steps"
            className="min-h-11 rounded-xl text-muted-foreground sm:min-h-9"
          >
            <ChevronDown className={cn("transition-transform duration-200", expanded && "rotate-180")} aria-hidden />
            {expanded ? "Less" : "All steps"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={dismiss}
            disabled={hiding}
            className="min-h-11 min-w-11 rounded-xl text-muted-foreground sm:min-h-9 sm:min-w-9"
            aria-label="Hide setup checklist"
          >
            <X aria-hidden />
          </Button>
        </div>
      </div>
      {expanded ? (
        <ol id="onboarding-steps" className={cn("mt-3 flex flex-col gap-2", ENTER_MOTION)}>
          {data.steps.map((step, i) => (
            <StepRow key={step.key} step={step} index={i} current={step.key === currentKey} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export default OnboardingChecklist;
