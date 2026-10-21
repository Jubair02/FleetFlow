"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Circle, FileUp, Plus, Rocket, X } from "lucide-react";
import { toast } from "sonner";
import { api, useApiData } from "@/lib/api-client";
import { onboardingProgress } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { goToDeliveriesAction, goToSettings, useAppStore } from "@/store/app-store";
import type { OnboardingData, OnboardingStep, OnboardingStepKey } from "@/lib/types-org";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

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
        "flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center",
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

/** Getting-started checklist shown on the dashboard until it's done or dismissed. */
export function OnboardingChecklist() {
  const { data, reload } = useApiData<OnboardingData>("/api/onboarding");
  const [hiding, setHiding] = useState(false);

  if (!data || data.dismissed || data.allDone) return null;

  const progress = onboardingProgress(data);
  const currentKey = data.steps.find((s) => !s.done && !s.optional)?.key ?? data.steps.find((s) => !s.done)?.key;

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
    <Card aria-labelledby="onboarding-title" className="gap-4 border-primary/30">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Rocket className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <CardTitle id="onboarding-title" className="text-base">
              Get your first delivery out
            </CardTitle>
            <CardDescription className="text-xs">
              Follow these steps in order — by the end a driver is carrying a tracked delivery with proof of delivery.
            </CardDescription>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={dismiss} disabled={hiding} className="shrink-0 text-muted-foreground">
          <X aria-hidden /> <span className="hidden sm:inline">Hide</span>
          <span className="sr-only sm:hidden">Hide checklist</span>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Progress value={progress.percent} aria-label={`${progress.done} of ${progress.total} steps done`} />
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            {progress.done} of {progress.total} done
          </span>
        </div>
        <ol className="flex flex-col gap-2">
          {data.steps.map((step, i) => (
            <StepRow key={step.key} step={step} index={i} current={step.key === currentKey} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export default OnboardingChecklist;
