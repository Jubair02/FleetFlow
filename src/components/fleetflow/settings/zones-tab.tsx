"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Calculator, MapPinned, Pencil, Plus, RefreshCw, Sparkles, Star, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, useApiData } from "@/lib/api-client";
import { formatBdt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { describeCodFee, describeWeightRule, STARTER_ZONES, type ZoneItem, type ZonePreview, type ZonesResponse } from "@/lib/zones";
import { useAppStore } from "@/store/app-store";
import { IconChip, LoadError, PANEL, ServerError } from "./shared";

// ─────────────────────────────────────────────────────────────
// Settings → Zones & charges (admin). Rules: src/lib/zones.ts, docs/ZONES.md.
// ─────────────────────────────────────────────────────────────

const DANGER_ACTION = "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/30 dark:bg-rose-600 dark:hover:bg-rose-700";
const AREA_PREVIEW = 14;
const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);
const refresh = () => useAppStore.getState().bump("/api/zones");

// ── Add / edit dialog ────────────────────────────────────────

interface ZoneForm {
  name: string;
  areas: string;
  baseFeeBdt: string;
  includedKg: string;
  perExtraKgBdt: string;
  codFeePercent: string;
  codFeeMinBdt: string;
  isDefault: boolean;
  active: boolean;
}

function formFrom(z: ZoneItem | null): ZoneForm {
  return {
    name: z?.name ?? "",
    areas: z?.areas.join(", ") ?? "",
    baseFeeBdt: z ? String(z.baseFeeBdt) : "",
    includedKg: z ? String(z.includedKg) : "1",
    perExtraKgBdt: z ? String(z.perExtraKgBdt) : "0",
    codFeePercent: z ? String(z.codFeePercent) : "0",
    codFeeMinBdt: z ? String(z.codFeeMinBdt) : "0",
    isDefault: z?.isDefault ?? false,
    active: z?.active ?? true,
  };
}

/** Keywords separated by commas, semicolons or new lines. */
function splitAreas(text: string): string[] {
  return text
    .split(/[,;\n]+/)
    .map((a) => a.trim())
    .filter(Boolean);
}

function NumberField({
  id,
  label,
  value,
  onChange,
  prefix,
  suffix,
  decimal,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  decimal?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden="true">
            {prefix}
          </span>
        ) : null}
        <Input
          id={id}
          inputMode={decimal ? "decimal" : "numeric"}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(decimal ? /[^\d.]/g : /\D/g, ""))}
          autoComplete="off"
          className={cn("min-h-11 sm:min-h-9", prefix && "pl-7", suffix && "pr-10")}
        />
        {suffix ? (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden="true">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ZoneDialog({ zone, open, onOpenChange }: { zone: ZoneItem | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [form, setForm] = useState<ZoneForm>(() => formFrom(zone));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const set = <K extends keyof ZoneForm>(k: K, v: ZoneForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.name.trim().length < 2) return setError("Name the zone, e.g. “Inside Dhaka”");
    if (form.baseFeeBdt.trim() === "") return setError("Enter the base delivery charge in taka");
    const body = {
      name: form.name.trim(),
      areas: splitAreas(form.areas),
      baseFeeBdt: Number(form.baseFeeBdt),
      includedKg: Number(form.includedKg || 0),
      perExtraKgBdt: Number(form.perExtraKgBdt || 0),
      codFeePercent: Number(form.codFeePercent || 0),
      codFeeMinBdt: Number(form.codFeeMinBdt || 0),
      isDefault: form.isDefault,
      active: form.active,
    };
    setSubmitting(true);
    try {
      if (zone) await api.patch(`/api/zones/${zone.id}`, body);
      else await api.post("/api/zones", body);
      toast.success(zone ? `“${body.name}” saved` : `“${body.name}” added`);
      onOpenChange(false);
      refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to save the zone"));
    } finally {
      setSubmitting(false);
    }
  };

  const areaCount = splitAreas(form.areas).length;
  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-3">
            <IconChip icon={MapPinned} />
            <DialogTitle>{zone ? `Edit ${zone.name}` : "Add a delivery zone"}</DialogTitle>
          </div>
          <DialogDescription>Deliveries whose address mentions one of the areas get this zone&apos;s price.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="zone-name">Zone name</Label>
            <Input
              id="zone-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              maxLength={60}
              placeholder="e.g. Inside Dhaka"
              autoComplete="off"
              className="min-h-11 sm:min-h-9"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="zone-areas">Areas</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{areaCount} keyword{areaCount === 1 ? "" : "s"}</span>
            </div>
            <Textarea
              id="zone-areas"
              value={form.areas}
              onChange={(e) => set("areas", e.target.value)}
              rows={4}
              placeholder="Dhanmondi, Mirpur, Uttara, ধানমন্ডি"
              aria-describedby="zone-areas-hint"
            />
            <p id="zone-areas-hint" className="text-xs text-muted-foreground">
              Separate with commas. Whole words, any case: “Mirpur” matches “Mirpur-10” but not “Mirpurkhas”. Bangla works too.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField id="zone-base" label="Base charge" prefix="৳" value={form.baseFeeBdt} onChange={(v) => set("baseFeeBdt", v)} />
            <NumberField id="zone-kg" label="Weight included" suffix="kg" decimal value={form.includedKg} onChange={(v) => set("includedKg", v)} />
            <NumberField id="zone-extra" label="Per extra kg" prefix="৳" value={form.perExtraKgBdt} onChange={(v) => set("perExtraKgBdt", v)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField id="zone-cod-pct" label="COD fee" suffix="%" decimal value={form.codFeePercent} onChange={(v) => set("codFeePercent", v)} />
            <NumberField id="zone-cod-min" label="Minimum COD fee" prefix="৳" value={form.codFeeMinBdt} onChange={(v) => set("codFeeMinBdt", v)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Charge = base + each started kg above the included weight × per-kg rate + COD fee (percent of the cash collected, at least the
            minimum) on cash-on-delivery orders.
          </p>
          <div className="space-y-3 rounded-lg border p-3">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={form.isDefault} onCheckedChange={(c) => set("isDefault", c === true)} className="mt-0.5" />
              <span>
                <span className="font-medium">Default zone</span>
                <span className="block text-xs text-muted-foreground">Used when no other zone&apos;s areas match (e.g. “Outside Dhaka”). Only one zone can be the default.</span>
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.active} onCheckedChange={(c) => set("active", c)} />
              <span className="font-medium">Active</span>
            </label>
          </div>
          <ServerError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} className="min-h-11 sm:min-h-9">
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="min-h-11 sm:min-h-9">
              {submitting ? "Saving…" : zone ? "Save zone" : "Add zone"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Test an address ──────────────────────────────────────────

function TestAddress({ hasZones }: { hasZones: boolean }) {
  const [address, setAddress] = useState("");
  const [weight, setWeight] = useState("");
  const [cod, setCod] = useState("");
  const [result, setResult] = useState<ZonePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return setError("Type an address to test");
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.post<ZonePreview>("/api/zones/preview", {
          address: address.trim(),
          weightKg: weight ? Number(weight) : null,
          codAmount: cod ? Number(cod) : null,
        })
      );
    } catch (err) {
      setResult(null);
      setError(errorMessage(err, "Couldn't test the address"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={PANEL} aria-labelledby="zone-test-title">
      <header className="flex items-start gap-3 border-b px-5 py-5 sm:px-6">
        <IconChip icon={Calculator} />
        <div className="min-w-0">
          <h3 id="zone-test-title" className="text-base font-semibold">
            Test an address
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">See which zone a delivery address falls into and what it would cost.</p>
        </div>
      </header>
      <form onSubmit={run} className="grid gap-3 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_auto] sm:items-end sm:px-6" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="zone-test-address">Delivery address</Label>
          <Input
            id="zone-test-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={300}
            placeholder="House 12, Road 5, Dhanmondi, Dhaka"
            className="min-h-11 sm:min-h-9"
          />
        </div>
        <NumberField id="zone-test-weight" label="Weight" suffix="kg" decimal value={weight} onChange={setWeight} />
        <NumberField id="zone-test-cod" label="COD" prefix="৳" value={cod} onChange={setCod} />
        <Button type="submit" variant="outline" disabled={busy || !hasZones} className="min-h-11 sm:min-h-9">
          {busy ? "Checking…" : "Check"}
        </Button>
      </form>
      <div className="px-5 pb-5 sm:px-6" aria-live="polite">
        <ServerError message={error} />
        {!hasZones ? <p className="text-xs text-muted-foreground">Add a zone first.</p> : null}
        {result ? (
          result.zone && result.fee ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p>
                <span className="font-semibold">{result.zone.name}</span>{" "}
                <span className="text-muted-foreground">
                  {result.kind === "area" ? `— matched “${result.matchedArea}”` : "— no area matched, default zone used"}
                </span>
              </p>
              <p className="mt-1 tabular-nums text-muted-foreground">
                Base {formatBdt(result.fee.baseBdt)}
                {result.fee.weightBdt ? ` + ${result.fee.extraKg} extra kg ${formatBdt(result.fee.weightBdt)}` : ""}
                {result.fee.codBdt ? ` + COD fee ${formatBdt(result.fee.codBdt)}` : ""} ={" "}
                <span className="font-semibold text-foreground">{formatBdt(result.fee.totalBdt)}</span>
              </p>
            </div>
          ) : (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              No zone matches and there is no default zone — this delivery would have no charge. Add the area to a zone or mark one zone as the default.
            </p>
          )
        ) : null}
      </div>
    </section>
  );
}

// ── Zone list ────────────────────────────────────────────────

function ZoneRow({
  zone,
  index,
  count,
  busy,
  onMove,
  onToggle,
  onEdit,
  onDelete,
}: {
  zone: ZoneItem;
  index: number;
  count: number;
  busy: boolean;
  onMove: (dir: -1 | 1) => void;
  onToggle: (active: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const areas = showAll ? zone.areas : zone.areas.slice(0, AREA_PREVIEW);
  return (
    <li className={cn("flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:px-6", !zone.active && "bg-muted/20")}>
      <div className="flex shrink-0 gap-1 sm:flex-col">
        <Button variant="ghost" size="icon" className="size-8" disabled={busy || index === 0} onClick={() => onMove(-1)} aria-label={`Move ${zone.name} up`}>
          <ArrowUp aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" disabled={busy || index === count - 1} onClick={() => onMove(1)} aria-label={`Move ${zone.name} down`}>
          <ArrowDown aria-hidden />
        </Button>
      </div>
      <div className={cn("min-w-0 flex-1", !zone.active && "opacity-70")}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold">{zone.name}</span>
          <span className="text-sm font-semibold tabular-nums text-primary">{formatBdt(zone.baseFeeBdt)}</span>
          {zone.isDefault ? (
            <Badge variant="outline" className="gap-1 border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
              <Star className="size-3" aria-hidden /> Default
            </Badge>
          ) : null}
          {!zone.active ? (
            <Badge variant="outline" className="border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
              Off
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {describeWeightRule(zone)} · {describeCodFee(zone)}
          {zone.openDeliveries ? ` · ${zone.openDeliveries} open deliver${zone.openDeliveries === 1 ? "y" : "ies"}` : ""}
        </p>
        {zone.areas.length ? (
          <ul className="mt-2 flex flex-wrap gap-1" aria-label={`Areas of ${zone.name}`}>
            {areas.map((a) => (
              <li key={a} className="rounded-md border bg-muted/40 px-1.5 py-0.5 text-xs">
                {a}
              </li>
            ))}
            {zone.areas.length > AREA_PREVIEW ? (
              <li>
                <button type="button" className="rounded-md px-1.5 py-0.5 text-xs font-medium text-primary hover:underline" onClick={() => setShowAll((s) => !s)}>
                  {showAll ? "Show less" : `+${zone.areas.length - AREA_PREVIEW} more`}
                </button>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground italic">{zone.isDefault ? "No areas — catches every address no other zone matches." : "No areas yet — only used when picked by hand."}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Switch checked={zone.active} disabled={busy} onCheckedChange={onToggle} aria-label={`${zone.name} active`} />
        <Button variant="outline" size="sm" onClick={onEdit} className="min-h-11 sm:min-h-8">
          <Pencil aria-hidden /> Edit
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete} aria-label={`Delete ${zone.name}`} className="size-9 text-muted-foreground hover:text-rose-600">
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  );
}

export function ZonesTab() {
  const { data, loading, error, reload } = useApiData<ZonesResponse>("/api/zones");
  const [editing, setEditing] = useState<{ zone: ZoneItem | null; seq: number } | null>(null);
  const [deleting, setDeleting] = useState<ZoneItem | null>(null);
  const [busy, setBusy] = useState(false);
  const zones = data?.items ?? [];

  const act = async (work: () => Promise<unknown>, success: string, failure: string) => {
    setBusy(true);
    try {
      await work();
      if (success) toast.success(success);
      refresh();
      return true;
    } catch (err) {
      toast.error(errorMessage(err, failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    const ids = zones.map((z) => z.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    void act(() => api.post("/api/zones/reorder", { ids }), "", "Couldn't change the order");
  };

  const addStarter = () =>
    act(
      async () => {
        const res = await api.post<{ created: string[] }>("/api/zones/starter");
        toast.success(res.created.length ? `Added ${res.created.join(", ")}` : "The starter zones are already there");
      },
      "",
      "Couldn't add the starter zones"
    );

  const recalculate = () =>
    act(
      async () => {
        let cursor: string | null = null;
        let updated = 0;
        // bounded batches; stop after a sane number of rounds
        for (let round = 0; round < 40; round++) {
          const res: { updated: number; nextCursor: string | null } = await api.post("/api/zones/recalculate", { cursor });
          updated += res.updated;
          cursor = res.nextCursor;
          if (!cursor) break;
        }
        toast.success(updated ? `Updated the charge on ${updated} open deliver${updated === 1 ? "y" : "ies"}` : "All open deliveries already have current prices");
        useAppStore.getState().bump("/api/deliveries");
      },
      "",
      "Couldn't recalculate charges"
    );

  if (error && !data) return <LoadError what="zones" error={error} onRetry={() => void reload()} />;

  return (
    <div className="space-y-6">
      <section className={PANEL} aria-labelledby="zones-title">
        <header className="flex flex-col gap-4 border-b px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <IconChip icon={MapPinned} />
            <div className="min-w-0">
              <h3 id="zones-title" className="text-base font-semibold">
                Delivery zones &amp; charges
              </h3>
              <p className="mt-0.5 text-xs text-pretty text-muted-foreground">
                Each delivery is priced by the first zone (top to bottom) whose areas appear in its address, else the default zone. Staff can
                still pick a zone or type a charge on any delivery.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {zones.length ? (
              <Button variant="outline" onClick={() => void recalculate()} disabled={busy} className="min-h-11 sm:min-h-9">
                <RefreshCw aria-hidden /> Re-price open deliveries
              </Button>
            ) : null}
            <Button onClick={() => setEditing({ zone: null, seq: Date.now() })} disabled={busy} className="min-h-11 sm:min-h-9">
              <Plus aria-hidden /> Add zone
            </Button>
          </div>
        </header>

        {loading && !data ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : zones.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-muted">
              <MapPinned className="size-6 text-muted-foreground" aria-hidden />
            </span>
            <p className="text-sm font-medium">No zones yet — deliveries have no charge</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Start with a common courier price list:{" "}
              {STARTER_ZONES.map((z) => `${z.name} ${formatBdt(z.baseFeeBdt)}`).join(" · ")}. You can change every price and area afterwards.
            </p>
            <Button variant="outline" onClick={() => void addStarter()} disabled={busy} className="min-h-11 sm:min-h-9">
              <Sparkles aria-hidden /> Use starter zones
            </Button>
          </div>
        ) : (
          <ul className="divide-y" aria-label="Delivery zones">
            {zones.map((z, i) => (
              <ZoneRow
                key={z.id}
                zone={z}
                index={i}
                count={zones.length}
                busy={busy}
                onMove={(dir) => move(i, dir)}
                onToggle={(active) =>
                  void act(() => api.patch(`/api/zones/${z.id}`, { active }), active ? `“${z.name}” is on` : `“${z.name}” is off`, "Couldn't update the zone")
                }
                onEdit={() => setEditing({ zone: z, seq: Date.now() })}
                onDelete={() => setDeleting(z)}
              />
            ))}
          </ul>
        )}
        {zones.length > 0 && !zones.some((z) => z.isDefault && z.active) ? (
          <p className="border-t px-5 py-3 text-xs text-amber-700 sm:px-6 dark:text-amber-300">
            No active default zone: addresses that match no area get no charge. Mark a zone such as “Outside Dhaka” as the default.
          </p>
        ) : null}
      </section>

      <TestAddress hasZones={zones.some((z) => z.active)} />

      {editing ? (
        <ZoneDialog key={editing.seq} zone={editing.zone} open onOpenChange={(o) => !o && setEditing(null)} />
      ) : null}

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && !busy && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Deliveries already in this zone keep the charge they have, but lose the zone name.
              {deleting?.openDeliveries
                ? ` ${deleting.openDeliveries} open deliver${deleting.openDeliveries === 1 ? "y is" : "ies are"} in it — turning the zone off instead keeps them linked.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 sm:min-h-9" disabled={busy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className={DANGER_ACTION}
              onClick={(e) => {
                e.preventDefault();
                const z = deleting;
                if (!z) return;
                void act(() => api.del(`/api/zones/${z.id}`), `“${z.name}” deleted`, "Couldn't delete the zone").then((done) => done && setDeleting(null));
              }}
            >
              Delete zone
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
