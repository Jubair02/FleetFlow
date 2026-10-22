"use client";

import { useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CreditCard,
  EyeOff,
  Info,
  LoaderCircle,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  RefreshCcw,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  FEATURE_KEYS,
  FEATURES,
  listPrice,
  PLAN_RESOURCES,
  RESOURCE_LABELS,
  type BillingCycle,
  type FeatureKey,
  type PlanResource,
} from "@/lib/plan-catalog";
import type { LimitImpactRow, PlanInput, PlatformPlansData } from "@/lib/platform-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { bumpPlatformData, platformApi, PlatformRequestError, usePlatformData } from "./platform-api";
import {
  BILLING_CYCLE_LABELS,
  Callout,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  errorProps,
  FieldError,
  fmtNum,
  formatBdt,
  formatPrice,
  PageHeader,
  PROPOSED_PRICE_NOTE,
  ServerError,
} from "./shared";

type PlanRow = PlatformPlansData["plans"][number];

const RESOURCE_ORDER: PlanResource[] = ["monthlyDeliveries", "drivers", "vehicles", "admins"];
const CYCLES: BillingCycle[] = ["MONTHLY", "ANNUAL"];

const CODE_RE = /^[a-z0-9-]{2,32}$/;
const NAME_MAX = 60;
const DESCRIPTION_MAX = 300;
const HIGHLIGHT_MAX = 120;
const HIGHLIGHTS_MAX = 8;
const PRICE_MAX = 10_000_000;
const LIMIT_MAX = 1_000_000;

function limitText(limit: number | null): string {
  return limit === null ? "Unlimited" : fmtNum(limit);
}

/** Usage labels read "this month"; a plan limit is a monthly allowance. */
function allowanceLabel(r: PlanResource): string {
  return RESOURCE_LABELS[r].replace("this month", "per month");
}

function planPath(code: string): string {
  return `/api/platform/plans/${encodeURIComponent(code)}`;
}

function plural(n: number, one: string, many: string): string {
  return `${fmtNum(n)} ${n === 1 ? one : many}`;
}

function impactFromError(err: unknown): LimitImpactRow[] | null {
  if (!(err instanceof PlatformRequestError) || err.status !== 409) return null;
  const impact = (err.data as { impact?: unknown } | null)?.impact;
  return Array.isArray(impact) ? (impact as LimitImpactRow[]) : null;
}

// ── View ─────────────────────────────────────────────────────

type DialogState =
  | { kind: "form"; plan: PlanRow | null }
  | { kind: "apply-price"; plan: PlanRow }
  | { kind: "status"; plan: PlanRow }
  | { kind: "default"; plan: PlanRow }
  | null;

export function PlansView() {
  const { data, error, reload } = usePlatformData<PlatformPlansData>("/api/platform/plans");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [seq, setSeq] = useState(0);
  const open = (d: DialogState) => {
    setSeq((n) => n + 1);
    setDialog(d);
  };
  const close = (o: boolean) => {
    if (!o) setDialog(null);
  };
  const plans = data?.plans ?? [];
  const currentDefault = plans.find((p) => p.isDefault) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Plans"
        description="Subscription tiers, their limits and list prices. Changes apply to the live product immediately."
        actions={
          <Button onClick={() => open({ kind: "form", plan: null })} disabled={!data}>
            <Plus aria-hidden /> New plan
          </Button>
        }
      />

      {error && !data ? (
        <ErrorState title="Couldn't load plans" message={error} onRetry={reload} />
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[30rem] w-full rounded-xl" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <Card className="py-0">
          <EmptyState
            icon={CreditCard}
            title="No plans yet"
            description="Create a plan before onboarding organizations — one must be the default for self-service sign-ups."
            action={
              <Button size="sm" className="mt-2" onClick={() => open({ kind: "form", plan: null })}>
                <Plus aria-hidden /> New plan
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {error && <ErrorState title="Showing the last loaded plans" message={error} onRetry={reload} />}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {plans.map((p) => (
              <PlanCard
                key={p.code}
                plan={p}
                onEdit={() => open({ kind: "form", plan: p })}
                onApplyPrice={() => open({ kind: "apply-price", plan: p })}
                onToggleActive={() => open({ kind: "status", plan: p })}
                onMakeDefault={() => open({ kind: "default", plan: p })}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{PROPOSED_PRICE_NOTE}.</p>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Info className="size-4 text-muted-foreground" aria-hidden /> How plan changes apply
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 text-sm text-muted-foreground">
            <ul className="ml-4 list-disc space-y-1">
              <li>Limits and features change for every subscriber straight away. Limits are only checked when something is added — lowering one never removes or disables existing data.</li>
              <li>Price changes set the list price for new assignments. Existing subscribers keep the price they agreed until you apply the new price to them.</li>
              <li>Inactive plans can&apos;t be assigned or chosen at sign-up; organizations already on them keep them.</li>
            </ul>
          </CardContent>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CreditCard className="size-4 text-muted-foreground" aria-hidden /> How billing works today
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-4 text-sm text-muted-foreground">
            <p>There is no payment gateway. Billing is manual:</p>
            <ol className="ml-4 list-decimal space-y-1">
              <li>Agree the plan, cycle and price with the customer and invoice them outside FleetFlow.</li>
              <li>Once paid, change the plan and record the subscription status, paid-until date and notes on the organization.</li>
              <li>If payment lapses, mark the subscription Past due; suspend only as a last resort.</li>
            </ol>
            <p>
              Full process: <code className="rounded bg-muted px-1 text-xs">docs/BILLING.md</code>.
            </p>
          </CardContent>
        </Card>
      </div>

      <PlanFormDialog
        key={`f-${seq}`}
        open={dialog?.kind === "form"}
        onOpenChange={close}
        plan={dialog?.kind === "form" ? dialog.plan : null}
        existingCodes={plans.map((p) => p.code)}
        nextSortOrder={plans.length ? Math.max(...plans.map((p) => p.sortOrder)) + 10 : 10}
      />
      {dialog?.kind === "apply-price" && <ApplyPriceDialog key={`a-${seq}`} plan={dialog.plan} onOpenChange={close} />}
      {dialog?.kind === "status" && <StatusDialog key={`s-${seq}`} plan={dialog.plan} onOpenChange={close} />}
      {dialog?.kind === "default" && <DefaultDialog key={`d-${seq}`} plan={dialog.plan} previous={currentDefault} onOpenChange={close} />}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────

function StateBadges({ plan }: { plan: PlanRow }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {plan.active ? (
        <Badge
          variant="outline"
          className="border-emerald-200 bg-emerald-50 font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          Active
        </Badge>
      ) : (
        <Badge variant="outline" className="border-zinc-200 bg-zinc-100 font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
          Inactive
        </Badge>
      )}
      {plan.isDefault && (
        <Badge variant="outline" className="gap-1 border-primary/20 bg-primary/10 font-medium text-primary" title="Given to new self-service sign-ups">
          <Star aria-hidden /> Default
        </Badge>
      )}
      {plan.isPublic ? (
        <Badge variant="outline" className="font-medium text-muted-foreground" title="Listed on the public pricing table">
          Public
        </Badge>
      ) : (
        <Badge variant="outline" className="gap-1 font-medium text-muted-foreground" title="Not on the public pricing table — staff can still assign it">
          <EyeOff aria-hidden /> Hidden
        </Badge>
      )}
    </div>
  );
}

function PriceBlock({ plan }: { plan: Pick<PlanRow, "monthlyPriceBdt" | "annualPriceBdt"> }) {
  const m = plan.monthlyPriceBdt;
  const a = plan.annualPriceBdt;
  if (m == null && a == null) {
    return (
      <div>
        <p className="text-2xl font-semibold tracking-tight">Free</p>
        <p className="mt-0.5 text-xs text-muted-foreground">no price on either cycle</p>
      </div>
    );
  }
  const saving = m != null && a != null && m > 0 && a < m * 12 ? Math.round((1 - a / (m * 12)) * 100) : 0;
  return (
    <div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">
        {m != null ? formatBdt(m) : formatBdt(a!)}
        <span className="ml-1 text-sm font-normal text-muted-foreground">/ {m != null ? "month" : "year"}</span>
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
        {m != null && a != null ? (
          <>
            or {formatBdt(a)} / year{saving > 0 ? ` · ${saving}% less than monthly` : ""}
          </>
        ) : m != null ? (
          "monthly only"
        ) : (
          "annual only"
        )}
      </p>
    </div>
  );
}

function PlanCard({
  plan,
  onEdit,
  onApplyPrice,
  onToggleActive,
  onMakeDefault,
}: {
  plan: PlanRow;
  onEdit: () => void;
  onApplyPrice: () => void;
  onToggleActive: () => void;
  onMakeDefault: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground",
        !plan.active && "border-dashed bg-muted/20",
        plan.isDefault && plan.active && "border-primary/40"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("truncate text-base font-semibold", !plan.active && "text-muted-foreground")}>{plan.name}</p>
          <code className="text-[11px] text-muted-foreground">{plan.code}</code>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil aria-hidden /> Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="size-8" aria-label={`More actions for ${plan.name}`}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{plan.name}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={onApplyPrice} disabled={plan.organizationCount === 0}>
                <RefreshCcw aria-hidden />
                <div className="flex flex-col">
                  <span>Apply new price to subscribers</span>
                  {plan.organizationCount === 0 && <span className="text-[11px] text-muted-foreground">No subscribers yet</span>}
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onMakeDefault} disabled={plan.isDefault || !plan.active}>
                <Star aria-hidden />
                <div className="flex flex-col">
                  <span>Make default for sign-ups</span>
                  {plan.isDefault ? (
                    <span className="text-[11px] text-muted-foreground">Already the default</span>
                  ) : !plan.active ? (
                    <span className="text-[11px] text-muted-foreground">Activate it first</span>
                  ) : null}
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onToggleActive} disabled={plan.active && plan.isDefault}>
                <Power aria-hidden />
                <div className="flex flex-col">
                  <span>{plan.active ? "Deactivate" : "Activate"}</span>
                  {plan.active && plan.isDefault && (
                    <span className="text-[11px] text-muted-foreground">Make another plan the default first</span>
                  )}
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <StateBadges plan={plan} />
      {plan.description && <p className="-mt-1 text-sm text-muted-foreground">{plan.description}</p>}

      <PriceBlock plan={plan} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="font-medium tabular-nums">{plural(plan.organizationCount, "subscriber", "subscribers")}</span>
        </span>
        {plan.grandfatheredCount > 0 && (
          <span className="text-violet-700 tabular-nums dark:text-violet-300" title="Subscribers whose agreed price differs from the current list price">
            {fmtNum(plan.grandfatheredCount)} grandfathered
          </span>
        )}
      </div>

      <dl className="flex flex-col gap-1.5 text-sm">
        {RESOURCE_ORDER.map((r) => (
          <div key={r} className="flex justify-between gap-2">
            <dt className="text-muted-foreground first-letter:uppercase">{allowanceLabel(r)}</dt>
            <dd className="shrink-0 tabular-nums">{limitText(plan.limits[r])}</dd>
          </div>
        ))}
      </dl>

      <ul className="flex flex-col gap-1.5 border-t pt-3 text-sm" aria-label="Features">
        {FEATURE_KEYS.map((f) => {
          const on = plan.features.includes(f);
          return (
            <li key={f} className={cn("flex gap-2", !on && "text-muted-foreground")}>
              {on ? (
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              ) : (
                <Minus className="mt-0.5 size-4 shrink-0 opacity-60" aria-hidden />
              )}
              <span>
                {FEATURES[f].label}
                <span className="sr-only">{on ? " (included)" : " (not included)"}</span>
              </span>
            </li>
          );
        })}
      </ul>

      {plan.highlights.length > 0 && (
        <div className="border-t pt-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Pricing-page highlights</p>
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {plan.highlights.map((h, i) => (
              <li key={`${i}-${h}`} className="flex gap-2">
                <span aria-hidden>·</span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-auto text-[11px] text-muted-foreground tabular-nums">Sort order {plan.sortOrder}</p>
    </div>
  );
}

// ── Create / edit form ───────────────────────────────────────

interface LimitField {
  value: string;
  unlimited: boolean;
}

interface FormState {
  code: string;
  name: string;
  description: string;
  monthly: string;
  annual: string;
  limits: Record<PlanResource, LimitField>;
  features: FeatureKey[];
  highlights: { id: number; text: string }[];
  isPublic: boolean;
  sortOrder: string;
}

type FormErrors = Partial<Record<"code" | "name" | "description" | "monthly" | "annual" | "sortOrder" | "highlights" | PlanResource, string>> & {
  highlightRows?: Record<number, string>;
};

function initialForm(plan: PlanRow | null, nextSortOrder: number): FormState {
  const limits = Object.fromEntries(
    PLAN_RESOURCES.map((r) => {
      const v = plan ? plan.limits[r] : null;
      return [r, { value: v === null ? "" : String(v), unlimited: plan ? v === null : false }];
    })
  ) as Record<PlanResource, LimitField>;
  return {
    code: plan?.code ?? "",
    name: plan?.name ?? "",
    description: plan?.description ?? "",
    monthly: plan?.monthlyPriceBdt == null ? "" : String(plan.monthlyPriceBdt),
    annual: plan?.annualPriceBdt == null ? "" : String(plan.annualPriceBdt),
    limits,
    features: plan ? [...plan.features] : [],
    highlights: (plan?.highlights ?? []).map((text, i) => ({ id: i + 1, text })),
    isPublic: plan?.isPublic ?? true,
    sortOrder: String(plan?.sortOrder ?? nextSortOrder),
  };
}

function parseWhole(raw: string): number | null | "invalid" {
  const t = raw.trim().replace(/,/g, "");
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return "invalid";
  return Number(t);
}

/** Validate & build the request body. Returns errors when the form is invalid. */
function buildPlanInput(f: FormState, opts: { creating: boolean; existingCodes: string[] }): { input: PlanInput } | { errors: FormErrors } {
  const e: FormErrors = {};
  const code = f.code.trim();
  if (opts.creating) {
    if (!CODE_RE.test(code)) e.code = "Use 2–32 lowercase letters, digits or hyphens (e.g. growth-plus)";
    else if (opts.existingCodes.includes(code)) e.code = "A plan with this code already exists";
  }
  const name = f.name.trim();
  if (name.length < 2) e.name = "Name must be at least 2 characters";
  else if (name.length > NAME_MAX) e.name = `Name must be ${NAME_MAX} characters or fewer`;
  const description = f.description.trim();
  if (description.length > DESCRIPTION_MAX) e.description = `Description must be ${DESCRIPTION_MAX} characters or fewer`;

  const price = (raw: string, key: "monthly" | "annual") => {
    const v = parseWhole(raw);
    if (v === "invalid" || (v !== null && v > PRICE_MAX)) {
      e[key] = `Enter a whole number of taka (0–${PRICE_MAX.toLocaleString("en-US")}), or leave empty`;
      return null;
    }
    return v;
  };
  const monthlyPriceBdt = price(f.monthly, "monthly");
  const annualPriceBdt = price(f.annual, "annual");

  const limits = {} as Record<PlanResource, number | null>;
  for (const r of PLAN_RESOURCES) {
    const field = f.limits[r];
    if (field.unlimited) {
      limits[r] = null;
      continue;
    }
    const v = parseWhole(field.value);
    if (v === null) e[r] = "Enter a limit or turn on Unlimited";
    else if (v === "invalid" || v > LIMIT_MAX) e[r] = `Enter a whole number (0–${LIMIT_MAX.toLocaleString("en-US")})`;
    limits[r] = typeof v === "number" ? v : null;
  }

  const highlightRows: Record<number, string> = {};
  const highlights: string[] = [];
  for (const h of f.highlights) {
    const t = h.text.trim();
    if (!t) continue;
    if (t.length > HIGHLIGHT_MAX) highlightRows[h.id] = `Keep it to ${HIGHLIGHT_MAX} characters`;
    highlights.push(t);
  }
  if (Object.keys(highlightRows).length) e.highlightRows = highlightRows;
  if (highlights.length > HIGHLIGHTS_MAX) e.highlights = `Up to ${HIGHLIGHTS_MAX} highlights`;

  const sort = f.sortOrder.trim();
  const sortOrder = Number(sort);
  if (!/^-?\d+$/.test(sort) || Math.abs(sortOrder) > 100_000) e.sortOrder = "Enter a whole number";

  if (Object.keys(e).length) return { errors: e };
  return {
    input: {
      code,
      name,
      description: description || null,
      monthlyPriceBdt,
      annualPriceBdt,
      limits,
      features: FEATURE_KEYS.filter((k) => f.features.includes(k)),
      highlights,
      isPublic: f.isPublic,
      sortOrder,
    },
  };
}

/** True when any limit got stricter (lower, or unlimited → a number) — only then can subscribers end up over. */
function limitsTightened(before: Record<PlanResource, number | null>, after: Record<PlanResource, number | null>): boolean {
  return PLAN_RESOURCES.some((r) => after[r] !== null && (before[r] === null || after[r]! < before[r]!));
}

function PlanFormDialog({
  open,
  onOpenChange,
  plan,
  existingCodes,
  nextSortOrder,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  plan: PlanRow | null;
  existingCodes: string[];
  nextSortOrder: number;
}) {
  const creating = plan === null;
  const [form, setForm] = useState<FormState>(() => initialForm(plan, nextSortOrder));
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [impact, setImpact] = useState<{ rows: LimitImpactRow[]; input: PlanInput } | null>(null);
  const nextId = useRef(form.highlights.length + 1);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((errs) => (errs[key as keyof FormErrors] ? { ...errs, [key]: undefined } : errs));
  };
  const setLimit = (r: PlanResource, patch: Partial<LimitField>) => {
    setForm((f) => ({ ...f, limits: { ...f.limits, [r]: { ...f.limits[r], ...patch } } }));
    setErrors((errs) => (errs[r] ? { ...errs, [r]: undefined } : errs));
  };
  const toggleFeature = (k: FeatureKey, on: boolean) =>
    setForm((f) => ({ ...f, features: on ? [...new Set([...f.features, k])] : f.features.filter((x) => x !== k) }));

  const priceChanged =
    !creating && (parseWhole(form.monthly) !== (plan.monthlyPriceBdt ?? null) || parseWhole(form.annual) !== (plan.annualPriceBdt ?? null));

  const finish = (input: PlanInput) => {
    bumpPlatformData();
    onOpenChange(false);
    if (creating) {
      toast.success(`${input.name} created`);
    } else if (priceChanged && plan.organizationCount > 0) {
      toast.success(`${input.name} updated`, {
        description: "Existing subscribers keep their agreed price. Use “Apply new price to subscribers” to re-price them.",
      });
    } else {
      toast.success(`${input.name} updated`);
    }
  };

  const save = async (input: PlanInput, confirmImpact: boolean) => {
    if (creating) {
      await platformApi.post("/api/platform/plans", input);
      finish(input);
      return;
    }
    const { code: _code, ...rest } = input;
    void _code;
    try {
      await platformApi.patch(planPath(plan.code), { action: "update", plan: rest, ...(confirmImpact ? { confirmImpact: true } : {}) });
      finish(input);
    } catch (err) {
      const rows = impactFromError(err);
      if (rows && rows.length && !confirmImpact) {
        setImpact({ rows, input });
        return;
      }
      throw err;
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const built = buildPlanInput(form, { creating, existingCodes });
    setServerError(null);
    if ("errors" in built) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const { input } = built;
      // Preview first when a limit got stricter on a plan that has subscribers.
      if (!creating && plan.organizationCount > 0 && limitsTightened(plan.limits, input.limits)) {
        let rows: LimitImpactRow[] | null = null;
        try {
          const res = await platformApi.post<{ impact: LimitImpactRow[] }>(`${planPath(plan.code)}/preview`, { limits: input.limits });
          rows = res.impact ?? [];
        } catch {
          rows = null; // Preview unavailable — the update itself answers 409 with the impact if needed.
        }
        if (rows && rows.length) {
          setImpact({ rows, input });
          return;
        }
      }
      await save(input, false);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not save the plan");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmImpact = async () => {
    if (!impact || submitting) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await save(impact.input, true);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not save the plan");
    } finally {
      setSubmitting(false);
    }
  };

  const filledHighlights = form.highlights.length;

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-2xl">
        {impact ? (
          <ImpactStep
            planName={impact.input.name}
            rows={impact.rows}
            submitting={submitting}
            serverError={serverError}
            onBack={() => {
              setImpact(null);
              setServerError(null);
            }}
            onConfirm={confirmImpact}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{creating ? "New plan" : `Edit ${plan.name}`}</DialogTitle>
              <DialogDescription>
                {creating
                  ? "New plans start active. Make one the default to give it to self-service sign-ups."
                  : `${plural(plan.organizationCount, "organization is", "organizations are")} on this plan. Limits and features change for them as soon as you save.`}
              </DialogDescription>
            </DialogHeader>
            <form id="plan-form" onSubmit={submit} className="-mx-6 min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-1" noValidate>
              {/* Identity */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pf-name">Name</Label>
                  <Input id="pf-name" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={NAME_MAX} disabled={submitting} {...errorProps("pf-name", errors.name)} />
                  <FieldError id="pf-name-error" message={errors.name} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pf-code">Code</Label>
                  {creating ? (
                    <>
                      <Input
                        id="pf-code"
                        value={form.code}
                        onChange={(e) => set("code", e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                        maxLength={32}
                        placeholder="e.g. growth-plus"
                        autoComplete="off"
                        spellCheck={false}
                        className="font-mono"
                        disabled={submitting}
                        aria-describedby={errors.code ? "pf-code-error" : "pf-code-hint"}
                        aria-invalid={errors.code ? true : undefined}
                      />
                      {errors.code ? (
                        <FieldError id="pf-code-error" message={errors.code} />
                      ) : (
                        <p id="pf-code-hint" className="text-[11px] text-muted-foreground">
                          Lowercase letters, digits and hyphens. Can&apos;t be changed later.
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <Input id="pf-code" value={plan.code} readOnly disabled className="font-mono" aria-describedby="pf-code-hint" />
                      <p id="pf-code-hint" className="text-[11px] text-muted-foreground">
                        The code is permanent — organizations and the audit log refer to it.
                      </p>
                    </>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pf-desc">
                  Description <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="pf-desc"
                  rows={2}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  maxLength={DESCRIPTION_MAX}
                  placeholder="Who this plan is for"
                  disabled={submitting}
                  {...errorProps("pf-desc", errors.description)}
                />
                <FieldError id="pf-desc-error" message={errors.description} />
              </div>

              {/* Prices */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">List prices (BDT)</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(["monthly", "annual"] as const).map((k) => (
                    <div key={k} className="space-y-1.5">
                      <Label htmlFor={`pf-${k}`} className="font-normal">
                        {k === "monthly" ? "Per month" : "Per year"}
                      </Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>
                          ৳
                        </span>
                        <Input
                          id={`pf-${k}`}
                          inputMode="numeric"
                          value={form[k]}
                          onChange={(e) => set(k, e.target.value)}
                          placeholder="Not offered"
                          maxLength={12}
                          className="pl-7 tabular-nums"
                          disabled={submitting}
                          {...errorProps(`pf-${k}`, errors[k])}
                        />
                      </div>
                      <FieldError id={`pf-${k}-error`} message={errors[k]} />
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">Empty = not offered on that cycle. Leave both empty for a free plan.</p>
                {priceChanged && (
                  <Callout tone="zinc">
                    Changes the list price for new assignments. Existing subscribers keep their agreed price
                    {plan.organizationCount > 0 ? " — use “Apply new price to subscribers” afterwards if you want to re-price them." : "."}
                  </Callout>
                )}
              </fieldset>

              {/* Limits */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">Limits</legend>
                <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                  {RESOURCE_ORDER.map((r) => {
                    const field = form.limits[r];
                    const id = `pf-limit-${r}`;
                    return (
                      <div key={r} className="space-y-1.5">
                        <Label htmlFor={id} className="font-normal first-letter:uppercase">
                          {allowanceLabel(r)}
                        </Label>
                        <div className="flex items-center gap-3">
                          <Input
                            id={id}
                            inputMode="numeric"
                            value={field.unlimited ? "" : field.value}
                            onChange={(e) => setLimit(r, { value: e.target.value })}
                            placeholder={field.unlimited ? "Unlimited" : "e.g. 10"}
                            disabled={submitting || field.unlimited}
                            maxLength={9}
                            className="tabular-nums"
                            {...errorProps(id, errors[r])}
                          />
                          <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                            <Switch
                              checked={field.unlimited}
                              onCheckedChange={(on) => setLimit(r, { unlimited: on })}
                              disabled={submitting}
                              aria-label={`Unlimited ${allowanceLabel(r)}`}
                            />
                            Unlimited
                          </label>
                        </div>
                        <FieldError id={`${id}-error`} message={errors[r]} />
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">Limits are checked only when something is added; existing data is never removed.</p>
              </fieldset>

              {/* Features */}
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Features</legend>
                <div className="grid gap-2">
                  {FEATURE_KEYS.map((k) => {
                    const id = `pf-feature-${k}`;
                    return (
                      <label key={k} htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:disabled]:cursor-default has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-primary/5">
                        <Checkbox
                          id={id}
                          checked={form.features.includes(k)}
                          onCheckedChange={(v) => toggleFeature(k, v === true)}
                          disabled={submitting}
                          className="mt-0.5"
                        />
                        <span className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">{FEATURES[k].label}</span>
                          <span className="text-xs text-muted-foreground">{FEATURES[k].description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {/* Highlights */}
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  Highlights <span className="font-normal text-muted-foreground">(pricing page bullet points, up to {HIGHLIGHTS_MAX})</span>
                </legend>
                {form.highlights.length === 0 && <p className="text-xs text-muted-foreground">No highlights — the pricing card shows limits only.</p>}
                <ul className="space-y-2">
                  {form.highlights.map((h, i) => {
                    const id = `pf-hl-${h.id}`;
                    const err = errors.highlightRows?.[h.id];
                    return (
                      <li key={h.id} className="space-y-1">
                        <div className="flex gap-2">
                          <Input
                            id={id}
                            value={h.text}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, highlights: f.highlights.map((x) => (x.id === h.id ? { ...x, text: e.target.value } : x)) }))
                            }
                            maxLength={HIGHLIGHT_MAX + 20}
                            placeholder="e.g. Priority support by phone"
                            aria-label={`Highlight ${i + 1}`}
                            disabled={submitting}
                            {...errorProps(id, err)}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setForm((f) => ({ ...f, highlights: f.highlights.filter((x) => x.id !== h.id) }))}
                            aria-label={`Remove highlight ${i + 1}`}
                            disabled={submitting}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                        <FieldError id={`${id}-error`} message={err} />
                      </li>
                    );
                  })}
                </ul>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={submitting || filledHighlights >= HIGHLIGHTS_MAX}
                  onClick={() => setForm((f) => ({ ...f, highlights: [...f.highlights, { id: nextId.current++, text: "" }] }))}
                >
                  <Plus aria-hidden /> Add highlight
                </Button>
                <FieldError id="pf-highlights-error" message={errors.highlights} />
              </fieldset>

              {/* Visibility */}
              <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                <label className="flex items-start gap-3 rounded-lg border p-3">
                  <Switch checked={form.isPublic} onCheckedChange={(v) => set("isPublic", v)} disabled={submitting} className="mt-0.5" aria-describedby="pf-public-hint" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">Show on public pricing</span>
                    <span id="pf-public-hint" className="text-xs text-muted-foreground">
                      Hidden plans stay off the sign-up page and pricing table, but staff can still assign them.
                    </span>
                  </span>
                </label>
                <div className="space-y-1.5">
                  <Label htmlFor="pf-sort">Sort order</Label>
                  <Input
                    id="pf-sort"
                    inputMode="numeric"
                    value={form.sortOrder}
                    onChange={(e) => set("sortOrder", e.target.value)}
                    maxLength={7}
                    className="tabular-nums"
                    disabled={submitting}
                    {...errorProps("pf-sort", errors.sortOrder)}
                  />
                  <FieldError id="pf-sort-error" message={errors.sortOrder} />
                  {!errors.sortOrder && <p className="text-[11px] text-muted-foreground">Lower shows first</p>}
                </div>
              </div>

              {Object.keys(errors).length > 0 && (
                <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">
                  Fix the highlighted fields to save.
                </p>
              )}
              <ServerError message={serverError} />
            </form>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" form="plan-form" disabled={submitting}>
                {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
                {creating ? "Create plan" : "Save changes"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImpactStep({
  planName,
  rows,
  submitting,
  serverError,
  onBack,
  onConfirm,
}: {
  planName: string;
  rows: LimitImpactRow[];
  submitting: boolean;
  serverError: string | null;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {plural(rows.length, "organization is", "organizations are")} over the new {planName} limits
        </DialogTitle>
        <DialogDescription>Review who is affected before saving.</DialogDescription>
      </DialogHeader>
      <Callout>Existing data is kept; these organizations can&apos;t add more until they&apos;re under the limit.</Callout>
      <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
        <ul className="divide-y rounded-lg border">
          {rows.map((row) => (
            <li key={row.organizationId} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <span className="min-w-0 truncate font-medium">{row.organizationName}</span>
              <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-rose-700 tabular-nums dark:text-rose-400">
                {row.over.map((o) => (
                  <span key={o.resource}>
                    <span className="first-letter:uppercase">{RESOURCE_LABELS[o.resource]}</span>: {fmtNum(o.usage)} of {fmtNum(o.limit)}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <ServerError message={serverError} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack} disabled={submitting}>
          <ArrowLeft aria-hidden /> Back to edit
        </Button>
        <Button type="button" onClick={onConfirm} disabled={submitting}>
          {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
          Save anyway
        </Button>
      </DialogFooter>
    </>
  );
}

// ── Apply price to subscribers ───────────────────────────────

function ApplyPriceDialog({ plan, onOpenChange }: { plan: PlanRow; onOpenChange: (o: boolean) => void }) {
  const offered = CYCLES.filter((c) => listPrice(plan, c) != null);
  const [cycle, setCycle] = useState<BillingCycle>(offered[0] ?? "MONTHLY");
  const price = listPrice(plan, cycle);
  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={`Apply the ${plan.name} list price to current subscribers?`}
      confirmLabel="Apply new price"
      canConfirm={price != null}
      description={
        <>
          Every {plan.name} subscriber billed {cycle === "ANNUAL" ? "annually" : "monthly"} is re-priced to the current list price, replacing any
          agreed or negotiated price. {plural(plan.organizationCount, "organization is", "organizations are")} on this plan across both cycles
          {plan.grandfatheredCount > 0 ? `, ${fmtNum(plan.grandfatheredCount)} currently on a different price` : ""}.
        </>
      }
      onConfirm={async () => {
        const res = await platformApi.patch<{ updated: number }>(planPath(plan.code), { action: "apply-price-to-subscribers", billingCycle: cycle });
        bumpPlatformData();
        toast.success(
          res.updated === 0
            ? `No ${BILLING_CYCLE_LABELS[cycle].toLowerCase()} subscribers needed re-pricing`
            : `${plural(res.updated, "subscriber", "subscribers")} moved to ${formatPrice(price, cycle)}`
        );
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="ap-cycle">Billing cycle</Label>
        <Select value={cycle} onValueChange={(v) => setCycle(v as BillingCycle)}>
          <SelectTrigger id="ap-cycle" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CYCLES.map((c) => (
              <SelectItem key={c} value={c}>
                {BILLING_CYCLE_LABELS[c]} — {listPrice(plan, c) == null ? "no list price" : formatPrice(listPrice(plan, c), c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {price == null ? (
        <Callout tone="zinc">
          {plan.name} has no {cycle === "ANNUAL" ? "annual" : "monthly"} list price, so there is nothing to apply. Set one by editing the plan first.
        </Callout>
      ) : (
        <Callout>
          New price: <span className="font-semibold tabular-nums">{formatPrice(price, cycle)}</span>. Recorded manually — no one is charged; let affected
          customers know before their next invoice.
        </Callout>
      )}
    </ConfirmDialog>
  );
}

// ── Activate / deactivate ────────────────────────────────────

function StatusDialog({ plan, onOpenChange }: { plan: PlanRow; onOpenChange: (o: boolean) => void }) {
  const deactivating = plan.active;
  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={deactivating ? `Deactivate ${plan.name}?` : `Activate ${plan.name}?`}
      destructive={deactivating}
      confirmLabel={deactivating ? "Deactivate plan" : "Activate plan"}
      canConfirm={!(deactivating && plan.isDefault)}
      description={
        deactivating ? (
          <ul className="ml-4 list-disc space-y-1">
            <li>It can&apos;t be assigned to new organizations or chosen at sign-up, and leaves the public pricing table.</li>
            <li>
              {plan.organizationCount > 0
                ? `The ${plural(plan.organizationCount, "organization", "organizations")} already on it keep it, with the same limits, features and price.`
                : "No organizations are on it."}
            </li>
            <li>You can activate it again at any time.</li>
          </ul>
        ) : (
          <>
            It can be assigned to organizations again{plan.isPublic ? " and appears on the public pricing table" : " (it stays hidden from public pricing)"}.
          </>
        )
      }
      onConfirm={async () => {
        await platformApi.patch(planPath(plan.code), { action: deactivating ? "deactivate" : "activate" });
        bumpPlatformData();
        toast.success(`${plan.name} ${deactivating ? "deactivated" : "activated"}`);
      }}
    >
      {deactivating && plan.isDefault && <Callout tone="rose">The default sign-up plan can&apos;t be deactivated. Make another plan the default first.</Callout>}
    </ConfirmDialog>
  );
}

// ── Default plan ─────────────────────────────────────────────

function DefaultDialog({ plan, previous, onOpenChange }: { plan: PlanRow; previous: PlanRow | null; onOpenChange: (o: boolean) => void }) {
  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={`Make ${plan.name} the default for sign-ups?`}
      confirmLabel="Make default"
      canConfirm={plan.active}
      description={
        <>
          New self-service sign-ups will start on {plan.name}
          {previous ? ` instead of ${previous.name}` : ""}. Existing organizations are not moved.
          {!plan.isPublic && " It is hidden from public pricing, so sign-ups won't see it listed there."}
        </>
      }
      onConfirm={async () => {
        await platformApi.patch(planPath(plan.code), { action: "make-default" });
        bumpPlatformData();
        toast.success(`${plan.name} is now the default sign-up plan`);
      }}
    />
  );
}
