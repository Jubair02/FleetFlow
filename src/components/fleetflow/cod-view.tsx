"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Banknote, HandCoins, History, PackageSearch, RefreshCw, Wallet } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, useApiData } from "@/lib/api-client";
import { formatBdt, formatDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CodSummary } from "@/lib/types-org";
import { goToDelivery, useAppStore } from "@/store/app-store";

const PANEL = "rounded-2xl border bg-card text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04)]";

type DriverCash = CodSummary["drivers"][number];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Tile({ icon: Icon, label, value, sub, tone }: { icon: typeof Wallet; label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className={cn(PANEL, "p-4")}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className={cn("flex size-7 items-center justify-center rounded-lg", tone)} aria-hidden="true">
          <Icon className="size-4" />
        </span>
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function SectionTitle({ icon: Icon, title, hint }: { icon: typeof Wallet; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-3 border-b px-5 py-4">
      <Icon className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

/** Cash on delivery: who is holding cash, recording handovers, short payments. */
export function CodView() {
  const { data, loading, error, reload } = useApiData<CodSummary>("/api/cod");
  const [settling, setSettling] = useState<DriverCash | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const settle = async () => {
    if (!settling) return;
    setSaving(true);
    try {
      await api.post("/api/cod/settlements", { driverId: settling.driverId, expectedAmount: settling.cashInHand, note: note.trim() });
      toast.success(`Recorded ${formatBdt(settling.cashInHand)} received from ${settling.name}`);
      setSettling(null);
      setNote("");
      useAppStore.getState().bump();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the handover");
      reload();
    } finally {
      setSaving(false);
    }
  };

  if (error && !data) {
    return (
      <div className={cn(PANEL, "flex flex-col items-start gap-3 p-6")}>
        <p className="text-sm text-destructive">Failed to load cash on delivery: {error}</p>
        <Button variant="outline" size="sm" onClick={reload}>
          <RefreshCw aria-hidden /> Try again
        </Button>
      </div>
    );
  }

  const t = data?.totals;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Cash on delivery</h2>
          <p className="text-sm text-muted-foreground">Track the cash drivers collect and record it when they hand it to the office.</p>
        </div>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw className={cn(loading && "animate-spin")} aria-hidden /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {t ? (
          <>
            <Tile icon={Wallet} label="With drivers" value={formatBdt(t.cashWithDrivers)} sub="Collected, not handed over" tone="bg-amber-500/10 text-amber-600 dark:text-amber-400" />
            <Tile icon={Banknote} label="Collected today" value={formatBdt(t.collectedToday)} sub={plural(t.collectedTodayCount, "delivery", "deliveries")} tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" />
            <Tile icon={HandCoins} label="Received today" value={formatBdt(t.settledToday)} sub="Handed to the office" tone="bg-sky-500/10 text-sky-600 dark:text-sky-400" />
            <Tile icon={PackageSearch} label="Still to collect" value={formatBdt(t.toCollect)} sub={plural(t.toCollectCount, "open delivery", "open deliveries")} tone="bg-violet-500/10 text-violet-600 dark:text-violet-400" />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[106px] rounded-2xl" />)
        )}
      </div>

      <section className={PANEL} aria-labelledby="cod-drivers">
        <SectionTitle icon={Wallet} title="Cash with drivers" hint="Record a handover when a driver gives you the cash they collected." />
        <h3 id="cod-drivers" className="sr-only">Cash with drivers</h3>
        {!data ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : data.drivers.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No driver is holding collected cash right now.</p>
        ) : (
          <ul className="divide-y">
            {data.drivers.map((d) => (
              <li key={d.driverId} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <span className="truncate">{d.name}</span>
                    {!d.active && <Badge variant="outline">Deactivated</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.deliveries} {d.deliveries === 1 ? "delivery" : "deliveries"}
                    {d.oldestCollectedAt && ` · oldest collected ${timeAgo(d.oldestCollectedAt)}`}
                    {d.phone && ` · ${d.phone}`}
                  </p>
                </div>
                <p className="text-lg font-semibold tabular-nums sm:w-32 sm:text-right">{formatBdt(d.cashInHand)}</p>
                <Button size="sm" className="min-h-11 sm:min-h-8" onClick={() => setSettling(d)}>
                  <HandCoins aria-hidden /> Record handover
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className={PANEL}>
          <SectionTitle icon={AlertTriangle} title="Short payments" hint="Collected less than was due, last 30 days." />
          {!data ? (
            <Skeleton className="m-5 h-12" />
          ) : data.short.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">No short payments. Every COD delivery was paid in full.</p>
          ) : (
            <ul className="divide-y">
              {data.short.map((s) => (
                <li key={s.deliveryId}>
                  <button type="button" onClick={() => goToDelivery(s.deliveryId)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {s.trackingCode} · {s.recipientName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.driverName ?? "Unknown driver"} · {formatDateTime(s.collectedAt)}
                      </p>
                    </div>
                    <div className="text-right text-sm tabular-nums">
                      <p className="font-semibold text-rose-600 dark:text-rose-400">−{formatBdt(s.codAmount - s.collected)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBdt(s.collected)} of {formatBdt(s.codAmount)}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={PANEL}>
          <SectionTitle icon={History} title="Recent handovers" hint="Cash received from drivers." />
          {!data ? (
            <Skeleton className="m-5 h-12" />
          ) : data.settlements.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">No handovers recorded yet.</p>
          ) : (
            <ul className="divide-y">
              {data.settlements.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.driverName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatDateTime(s.createdAt)} · received by {s.receivedByName}
                      {s.note && ` · ${s.note}`}
                    </p>
                  </div>
                  <div className="text-right text-sm tabular-nums">
                    <p className="font-semibold">{formatBdt(s.amount)}</p>
                    <p className="text-xs text-muted-foreground">{plural(s.deliveryCount, "delivery", "deliveries")}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <AlertDialog open={settling !== null} onOpenChange={(o) => !o && !saving && setSettling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Record cash handover</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm you received <strong className="text-foreground">{settling ? formatBdt(settling.cashInHand) : ""}</strong> from{" "}
              {settling?.name} for {settling?.deliveries} {settling?.deliveries === 1 ? "delivery" : "deliveries"}. Count the cash before
              confirming — this can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cod-note">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea id="cod-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} placeholder="e.g. Counted by Rahim at the depot" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(e) => {
                e.preventDefault();
                void settle();
              }}
            >
              {saving ? "Recording…" : "Confirm received"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
