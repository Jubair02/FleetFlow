"use client";

import { useEffect, useState } from "react";
import { Loader2, Receipt } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, useApiData } from "@/lib/api-client";
import { formatBdt } from "@/lib/format";
import type { Delivery } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ZonePreview, ZonesResponse } from "@/lib/zones";

// ─────────────────────────────────────────────────────────────
// Delivery form → weight, zone and delivery charge (docs/ZONES.md).
// Self-contained: the form keeps a ChargeInput in its state, renders
// <DeliveryChargeFields> and merges chargeBody() into the request.
// ─────────────────────────────────────────────────────────────

const AUTO = "auto";

export interface ChargeInput {
  /** kg as typed ("" = not weighed). */
  weight: string;
  /** "auto" or a zone id. */
  zone: string;
  /** Edit mode: the zone select was changed (otherwise the server decides). */
  zoneTouched: boolean;
  /** Typed charge in taka ("" = calculate from the zone). */
  fee: string;
}

export function chargeInputFrom(d: Delivery | null): ChargeInput {
  const c = d?.charge ?? null;
  return {
    weight: c?.weightKg != null ? String(c.weightKg) : "",
    zone: c?.zoneId ?? AUTO,
    zoneTouched: false,
    fee: c?.feeOverridden && c.deliveryFeeBdt != null ? String(c.deliveryFeeBdt) : "",
  };
}

const weightValue = (s: string): number | null => (s.trim() && Number(s) > 0 ? Number(s) : null);
const feeValue = (s: string): number | null => (s.trim() ? Number(s) : null);

/** Client-side check matching the server's limits; undefined = fine. */
export function chargeError(input: ChargeInput): string | undefined {
  const w = input.weight.trim();
  if (w && (!/^\d+(\.\d+)?$/.test(w) || !(Number(w) > 0) || Number(w) > 1000)) return "Enter the weight in kg, more than 0 and at most 1000 (e.g. 1.5).";
  const f = input.fee.trim();
  if (f && (!/^\d+$/.test(f) || Number(f) > 100_000)) return "Enter the delivery charge in whole taka (e.g. 120).";
  return undefined;
}

/**
 * Request fields. Create: everything. Edit: only what changed — the zone only
 * when the select was touched (an address change re-matches it on the server).
 */
export function chargeBody(input: ChargeInput, initial: ChargeInput | null): Record<string, unknown> {
  if (!initial) {
    return { weightKg: weightValue(input.weight), zoneId: input.zone === AUTO ? null : input.zone, deliveryFeeBdt: feeValue(input.fee) };
  }
  const body: Record<string, unknown> = {};
  if (input.weight.trim() !== initial.weight.trim()) body.weightKg = weightValue(input.weight);
  if (input.zoneTouched && input.zone !== initial.zone) body.zoneId = input.zone === AUTO ? null : input.zone;
  if (input.fee.trim() !== initial.fee.trim()) body.deliveryFeeBdt = feeValue(input.fee);
  return body;
}

export function DeliveryChargeFields({
  idPrefix,
  value,
  onChange,
  address,
  codAmount,
  initial,
  addressChanged,
  error,
}: {
  idPrefix: string;
  value: ChargeInput;
  onChange: (next: ChargeInput) => void;
  address: string;
  codAmount: number | null;
  /** Edit mode: the loaded delivery's values. */
  initial: ChargeInput | null;
  addressChanged: boolean;
  error?: string;
}) {
  const zones = useApiData<ZonesResponse>("/api/zones");
  const choices = (zones.data?.items ?? []).filter((z) => z.active || z.id === initial?.zone);

  // The zone the server will use: picked, kept (edit, untouched, same address) or matched.
  const effectiveZone = !initial || value.zoneTouched ? (value.zone === AUTO ? null : value.zone) : addressChanged || initial.zone === AUTO ? null : initial.zone;
  const weightKg = weightValue(value.weight);
  const requestKey = JSON.stringify({ address: address.trim(), weightKg, codAmount, zoneId: effectiveZone });

  const [preview, setPreview] = useState<{ key: string; result: ZonePreview | null; error: string | null } | null>(null);
  useEffect(() => {
    if (address.trim().length < 3 && !effectiveZone) return;
    const timer = setTimeout(() => {
      api
        .post<ZonePreview>("/api/zones/preview", JSON.parse(requestKey))
        .then((result) => setPreview({ key: requestKey, result, error: null }))
        .catch((err: unknown) => setPreview({ key: requestKey, result: null, error: err instanceof Error ? err.message : "Couldn't price this delivery" }));
    }, 350);
    return () => clearTimeout(timer);
  }, [requestKey, address, effectiveZone]);

  const current = preview?.key === requestKey ? preview : null;
  const pending = !current && address.trim().length >= 3;
  const auto = current?.result && current.result.kind !== "manual" ? current.result.zone : null;
  const autoLabel = auto ? `Auto: ${auto.name}` : "Auto (match the address)";
  const fee = current?.result?.fee ?? null;
  const set = (patch: Partial<ChargeInput>) => onChange({ ...value, ...patch });
  const selectValue = initial && !value.zoneTouched && addressChanged ? AUTO : value.zone;

  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <legend className="flex items-center gap-1.5 px-1 text-sm font-medium">
        <Receipt className="size-3.5 text-muted-foreground" aria-hidden /> Delivery charge
      </legend>
      <div className="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)_8rem]">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-weight`}>Weight (kg)</Label>
          <Input
            id={`${idPrefix}-weight`}
            inputMode="decimal"
            value={value.weight}
            onChange={(e) => set({ weight: e.target.value.replace(/[^\d.]/g, "") })}
            placeholder="0.5"
            autoComplete="off"
            className="min-h-11 sm:min-h-9"
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${idPrefix}-zone`}>Zone</Label>
          <Select value={selectValue} onValueChange={(v) => set({ zone: v, zoneTouched: true })}>
            <SelectTrigger id={`${idPrefix}-zone`} className="min-h-11 w-full sm:min-h-9">
              <SelectValue placeholder="Zone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>{autoLabel}</SelectItem>
              {choices.map((z) => (
                <SelectItem key={z.id} value={z.id}>
                  {z.name} · {formatBdt(z.baseFeeBdt)}
                  {z.active ? "" : " (off)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-fee`}>Override charge</Label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden="true">
              ৳
            </span>
            <Input
              id={`${idPrefix}-fee`}
              inputMode="numeric"
              value={value.fee}
              onChange={(e) => set({ fee: e.target.value.replace(/\D/g, "") })}
              placeholder={fee ? String(fee.totalBdt) : "Auto"}
              autoComplete="off"
              aria-describedby={`${idPrefix}-fee-summary`}
              className={cn("min-h-11 pl-7 sm:min-h-9", error && "border-destructive")}
            />
          </div>
        </div>
      </div>
      <div id={`${idPrefix}-fee-summary`} className="text-xs text-muted-foreground" aria-live="polite">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : value.fee.trim() ? (
          <p>
            Charge set by hand: <span className="font-semibold text-foreground">{formatBdt(Number(value.fee))}</span> — it won&apos;t be recalculated.
            Clear it to use the zone price{fee ? ` (${formatBdt(fee.totalBdt)})` : ""}.
          </p>
        ) : pending ? (
          <p className="flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Pricing…
          </p>
        ) : current?.error ? (
          <p className="text-amber-700 dark:text-amber-300">{current.error}</p>
        ) : current?.result && fee && current.result.zone ? (
          <p className="tabular-nums">
            {current.result.zone.name}
            {current.result.kind === "area" ? ` (matched “${current.result.matchedArea}”)` : current.result.kind === "default" ? " (default zone)" : ""}: base{" "}
            {formatBdt(fee.baseBdt)}
            {fee.weightBdt ? ` + ${fee.extraKg} extra kg ${formatBdt(fee.weightBdt)}` : ""}
            {fee.codBdt ? ` + COD fee ${formatBdt(fee.codBdt)}` : ""} = <span className="font-semibold text-foreground">{formatBdt(fee.totalBdt)}</span>
          </p>
        ) : current?.result && !current.result.zonesConfigured ? (
          <p>No delivery zones set up — an admin can add them in Settings → Zones &amp; charges, or type a charge.</p>
        ) : current?.result ? (
          <p className="text-amber-700 dark:text-amber-300">No zone matches this address — pick one or type a charge.</p>
        ) : (
          <p>Enter the delivery address to see the charge.</p>
        )}
      </div>
    </fieldset>
  );
}
