"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  ImagePlus,
  LoaderCircle,
  MessageSquareText,
  Palette,
  Phone,
  Star,
  Trash2,
  Truck,
} from "lucide-react";

import { UpgradeExplainer } from "@/components/fleetflow/plan-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, useApiData } from "@/lib/api-client";
import {
  BRAND_LOGO_MAX_BYTES,
  BRAND_LOGO_TYPES,
  BRAND_PRESETS,
  MIN_TEXT_CONTRAST,
  TRACKING_MESSAGE_MAX,
  brandPalette,
  normalizeHexColor,
  readableTextColor,
  type TrackingSettingsResponse,
} from "@/lib/branding";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { goToSettings } from "@/store/app-store";
import { LoadError, PANEL, ServerError, SettingsSection } from "./shared";

// ─────────────────────────────────────────────────────────────
// Settings → Tracking page: what recipients see on their tracking link.
// Branding (logo, accent colour, message) needs the branded_tracking plan
// feature; customer ratings and rescheduling are on every plan.
// docs/CUSTOMER-EXPERIENCE.md
// ─────────────────────────────────────────────────────────────

const DEFAULT_ACCENT = "#047857"; // FleetFlow emerald-700, shown when no colour is set

interface Form {
  brandColor: string;
  trackingMessage: string;
  allowCustomerRating: boolean;
  allowCustomerReschedule: boolean;
}

function toForm(s: TrackingSettingsResponse["settings"]): Form {
  return {
    brandColor: s.brandColor ?? "",
    trackingMessage: s.trackingMessage ?? "",
    allowCustomerRating: s.allowCustomerRating,
    allowCustomerReschedule: s.allowCustomerReschedule,
  };
}

// ── live preview ─────────────────────────────────────────────

function Preview({ form, logoUrl, company, branded }: { form: Form; logoUrl: string | null; company: TrackingSettingsResponse["company"]; branded: boolean }) {
  const color = branded ? normalizeHexColor(form.brandColor) : null;
  const solid = color ? brandPalette(color).solid : null;
  const message = branded ? form.trackingMessage.trim() : "";
  const logo = branded ? logoUrl : null;
  const name = company.name || "Your company";

  return (
    <div className={cn(PANEL, "overflow-hidden")}>
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Live preview</p>
        <span className="text-[11px] text-muted-foreground">What recipients see</span>
      </div>
      <div className="m-4 overflow-hidden rounded-xl border bg-muted/40 dark:bg-background">
        <div className="flex h-12 items-center gap-2.5 border-b bg-card px-3">
          {logo ? (
            <span className="flex h-8 max-w-24 items-center overflow-hidden rounded-lg bg-white px-1 ring-1 ring-border/70">
              <img src={logo} alt={`${name} logo`} className="max-h-6 w-auto max-w-full object-contain" />
            </span>
          ) : (
            <span
              className={cn("flex size-8 items-center justify-center rounded-lg text-[11px] font-semibold text-white", !solid && "bg-gradient-to-br from-emerald-700 to-teal-700")}
              style={solid ? { backgroundColor: solid } : undefined}
              aria-hidden="true"
            >
              {initials(name)}
            </span>
          )}
          <div className="min-w-0 leading-tight">
            <p className="text-[10px] text-muted-foreground">Delivery from</p>
            <p className="truncate text-xs font-semibold">{name}</p>
          </div>
        </div>
        <div className="space-y-2.5 p-3">
          <div
            className={cn("rounded-xl p-3.5 text-white", !solid && "bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600")}
            style={solid ? { backgroundColor: solid } : undefined}
          >
            <p className="inline-flex rounded-full bg-black/20 px-2 py-0.5 font-mono text-[10px]">FF-261030-K7QX</p>
            <p className="mt-2.5 text-lg font-semibold tracking-tight">On the way</p>
            <p className="mt-0.5 text-xs text-white/95">Your parcel is with the courier.</p>
          </div>
          {message ? (
            <div className="flex gap-2 rounded-xl border bg-card p-2.5">
              <MessageSquareText className="mt-0.5 size-3.5 shrink-0" style={{ color: solid ?? undefined }} aria-hidden="true" />
              <p className="text-xs break-words whitespace-pre-line">{message}</p>
            </div>
          ) : null}
          {form.allowCustomerReschedule ? (
            <div className="rounded-xl border bg-card p-2.5">
              <p className="text-xs font-semibold">Can&apos;t receive it?</p>
              <p className="mt-1 inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px]">
                <CalendarClock className="size-3" aria-hidden="true" /> Choose another day
              </p>
            </div>
          ) : null}
          {company.phone ? (
            <p
              className={cn("flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-white", !solid && "bg-emerald-700")}
              style={solid ? { backgroundColor: solid } : undefined}
            >
              <Phone className="size-3" aria-hidden="true" /> Call {name}
            </p>
          ) : null}
          {form.allowCustomerRating ? (
            <div className="rounded-xl border bg-card p-2.5">
              <p className="text-xs font-semibold">How was your delivery?</p>
              <span className="mt-1 inline-flex gap-0.5" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className={cn("size-3.5", n <= 4 ? "fill-amber-400 text-amber-400" : "text-muted-foreground/50")} />
                ))}
              </span>
              <span className="ml-1.5 text-[10px] text-muted-foreground">after delivery</span>
            </div>
          ) : null}
          <p className="flex items-center justify-center gap-1 pt-1 text-[10px] text-muted-foreground">
            <Truck className="size-3" aria-hidden="true" /> Tracking powered by FleetFlow
          </p>
        </div>
      </div>
      <p className="px-4 pb-4 text-xs text-muted-foreground">Recipients can switch the page between বাংলা and English.</p>
    </div>
  );
}

// ── logo ─────────────────────────────────────────────────────

function LogoField({ logoUrl, locked, onChanged }: { logoUrl: string | null; locked: boolean; onChanged: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    if (!(BRAND_LOGO_TYPES as readonly string[]).includes(file.type)) {
      setError("Use a PNG, JPEG or WebP image (SVG isn't accepted).");
      return;
    }
    if (file.size > BRAND_LOGO_MAX_BYTES) {
      setError("The logo must be 1 MB or smaller.");
      return;
    }
    const body = new FormData();
    body.set("file", file);
    setBusy(true);
    try {
      await api.post("/api/settings/tracking/logo", body);
      toast.success("Logo uploaded");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.del("/api/settings/tracking/logo");
      toast.success("Logo removed");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove the logo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 sm:col-span-2">
      <Label htmlFor="tracking-logo">Logo</Label>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-14 w-28 items-center justify-center overflow-hidden rounded-xl border bg-white p-1.5">
          {logoUrl ? (
            <img src={logoUrl} alt="Current logo" className="max-h-full w-auto max-w-full object-contain" />
          ) : (
            <ImagePlus className="size-5 text-zinc-400" aria-hidden="true" />
          )}
        </span>
        <input
          ref={input}
          id="tracking-logo"
          type="file"
          accept={BRAND_LOGO_TYPES.join(",")}
          className="sr-only"
          disabled={locked || busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
          aria-describedby="tracking-logo-hint"
        />
        <Button type="button" variant="outline" disabled={locked || busy} onClick={() => input.current?.click()} className="min-h-11 sm:min-h-9">
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ImagePlus aria-hidden="true" />}
          {logoUrl ? "Replace logo" : "Upload logo"}
        </Button>
        {logoUrl ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()} className="min-h-11 text-muted-foreground sm:min-h-9">
            <Trash2 aria-hidden="true" /> Remove
          </Button>
        ) : null}
      </div>
      <p id="tracking-logo-hint" className="text-xs text-muted-foreground">
        PNG, JPEG or WebP, up to 1 MB. A wide logo on a transparent or white background works best.
      </p>
      {error ? (
        <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── colour ───────────────────────────────────────────────────

function ColorField({ value, locked, onChange }: { value: string; locked: boolean; onChange: (v: string) => void }) {
  const normalized = normalizeHexColor(value);
  const invalid = value.trim() !== "" && !normalized;
  const palette = normalized ? brandPalette(normalized) : null;

  return (
    <div className="space-y-2.5 sm:col-span-2">
      <Label htmlFor="tracking-color">Accent colour</Label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Colour presets">
        {BRAND_PRESETS.map((p) => {
          const active = normalized === p.value;
          return (
            <button
              key={p.value}
              type="button"
              disabled={locked}
              onClick={() => onChange(p.value)}
              aria-pressed={active}
              title={p.name}
              className={cn(
                "flex size-9 items-center justify-center rounded-full ring-offset-2 ring-offset-background outline-none transition-transform focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 motion-safe:active:scale-95",
                active && "ring-2 ring-foreground",
              )}
              style={{ backgroundColor: p.value }}
            >
              <span className="sr-only">{p.name}</span>
              {active ? <CheckCircle2 className="size-4" style={{ color: readableTextColor(p.value) }} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label="Pick a custom colour"
          disabled={locked}
          value={normalized ?? DEFAULT_ACCENT}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-12 cursor-pointer rounded-md border bg-background p-1 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Input
          id="tracking-color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#0F766E"
          maxLength={7}
          disabled={locked}
          className="h-9 w-32 font-mono uppercase"
          aria-invalid={invalid || undefined}
          aria-describedby="tracking-color-hint"
        />
        {value ? (
          <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => onChange("")} className="text-muted-foreground">
            Use default
          </Button>
        ) : null}
      </div>
      <div id="tracking-color-hint" aria-live="polite">
        {invalid ? (
          <p className="text-xs text-rose-600 dark:text-rose-400">Enter a colour like #0F766E.</p>
        ) : palette ? (
          palette.whiteContrast >= MIN_TEXT_CONTRAST ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              White text on this colour is easy to read ({palette.whiteContrast.toFixed(1)}:1).
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>
                This colour is light — white text on it is only {palette.whiteContrast.toFixed(1)}:1. The tracking page will use a darker shade
                <span className="mx-1 inline-block size-3 translate-y-0.5 rounded-sm ring-1 ring-black/10" style={{ backgroundColor: palette.solid }} aria-hidden="true" />
                <code className="font-mono">{palette.solid}</code> behind text so everyone can read it.
              </span>
            </p>
          )
        ) : (
          <p className="text-xs text-muted-foreground">No colour set — the page uses FleetFlow green.</p>
        )}
      </div>
    </div>
  );
}

// ── form ─────────────────────────────────────────────────────

function ToggleRow({ id, title, description, checked, onChange }: { id: string; title: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 sm:col-span-2">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">
          {title}
        </Label>
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-pretty text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-hint`} className="mt-0.5" />
    </div>
  );
}

function TrackingForm({ data, reload }: { data: TrackingSettingsResponse; reload: () => Promise<void> }) {
  const initial = toForm(data.settings);
  const [form, setForm] = useState<Form>(initial);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const locked = !data.branded;

  const colorValid = form.brandColor.trim() === "" || !!normalizeHexColor(form.brandColor);
  const normColor = normalizeHexColor(form.brandColor);
  const changes: Record<string, unknown> = {};
  if ((normColor ?? "") !== (initial.brandColor ?? "") && colorValid) changes.brandColor = normColor;
  if (form.trackingMessage.trim() !== initial.trackingMessage) changes.trackingMessage = form.trackingMessage.trim() || null;
  if (form.allowCustomerRating !== initial.allowCustomerRating) changes.allowCustomerRating = form.allowCustomerRating;
  if (form.allowCustomerReschedule !== initial.allowCustomerReschedule) changes.allowCustomerReschedule = form.allowCustomerReschedule;
  const dirty = Object.keys(changes).length > 0 || !colorValid;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!colorValid) return;
    setSaving(true);
    setServerError(null);
    try {
      await api.patch("/api/settings/tracking", changes);
      toast.success("Tracking page saved");
      await reload();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const left = TRACKING_MESSAGE_MAX - form.trackingMessage.length;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-4">
        {locked ? (
          <section className={cn(PANEL, "space-y-4 p-5 sm:p-6")} aria-label="Upgrade for branded tracking">
            <UpgradeExplainer
              feature="branded_tracking"
              planName={data.planName}
              message="Ratings and rescheduling below work on every plan. Your company name and phone always show on the page."
            />
            <Button type="button" onClick={() => goToSettings("plan")} className="min-h-11 sm:min-h-9">
              <CreditCard aria-hidden="true" /> See plans
            </Button>
          </section>
        ) : null}

        <form onSubmit={submit} noValidate className={cn(PANEL, "min-w-0")} aria-label="Tracking page settings">
          <div className="divide-y">
            <SettingsSection icon={Palette} title="Branding" description="Your logo and colour on every tracking link, instead of FleetFlow's.">
              <LogoField logoUrl={data.settings.logoUrl} locked={locked} onChanged={reload} />
              <ColorField value={form.brandColor} locked={locked} onChange={(v) => setForm((f) => ({ ...f, brandColor: v }))} />
            </SettingsSection>

            <SettingsSection icon={MessageSquareText} title="Message" description="A short note shown on every tracking page — opening hours, a thank-you, a promotion.">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="tracking-message">Message for recipients (optional)</Label>
                <Textarea
                  id="tracking-message"
                  rows={3}
                  maxLength={TRACKING_MESSAGE_MAX}
                  value={form.trackingMessage}
                  disabled={locked}
                  onChange={(e) => setForm((f) => ({ ...f, trackingMessage: e.target.value }))}
                  placeholder="e.g. Thanks for shopping with us! Deliveries run 9 am – 9 pm, Saturday to Thursday."
                  aria-describedby="tracking-message-count"
                />
                <p id="tracking-message-count" className={cn("text-xs tabular-nums", left < 20 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                  {left} characters left
                </p>
              </div>
            </SettingsSection>

            <SettingsSection icon={Star} title="Customer feedback" description="What recipients can do from their tracking link. Included in every plan.">
              <ToggleRow
                id="tracking-rating"
                title="Ask for a rating after delivery"
                description="Recipients can give 1–5 stars and a comment once, within 14 days of delivery. Ratings show on the delivery and in Reports."
                checked={form.allowCustomerRating}
                onChange={(v) => setForm((f) => ({ ...f, allowCustomerRating: v }))}
              />
              <ToggleRow
                id="tracking-reschedule"
                title="Let recipients ask for another day"
                description="While a delivery is pending, assigned or failed, recipients can pick a day in the next 14 days and a time window. You accept or decline it from the delivery."
                checked={form.allowCustomerReschedule}
                onChange={(v) => setForm((f) => ({ ...f, allowCustomerReschedule: v }))}
              />
            </SettingsSection>
          </div>

          {serverError ? (
            <div className="px-5 pb-4 sm:px-6">
              <ServerError message={serverError} />
            </div>
          ) : null}

          <div
            className={cn(
              "z-10 flex flex-col gap-3 rounded-b-2xl border-t bg-card/95 px-5 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:flex-row sm:items-center sm:justify-between sm:px-6",
              dirty && "sticky bottom-0 shadow-[0_-10px_24px_-14px_rgb(0_0_0/0.18)]",
            )}
          >
            <p className="flex items-center gap-2 text-xs" aria-live="polite">
              {dirty ? (
                <>
                  <span className="size-2 rounded-full bg-amber-500 motion-safe:animate-pulse" aria-hidden="true" />
                  <span className="font-medium">You have unsaved changes</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <span className="text-muted-foreground">All changes saved</span>
                </>
              )}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => setForm(initial)} className="min-h-11 sm:min-h-9">
                Discard
              </Button>
              <Button type="submit" disabled={!dirty || saving || !colorValid} className="min-h-11 sm:min-h-9">
                {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </form>
      </div>

      <aside className="xl:sticky xl:top-20" aria-label="Preview">
        <Preview form={form} logoUrl={data.settings.logoUrl} company={data.company} branded={data.branded} />
      </aside>
    </div>
  );
}

export function TrackingTab() {
  const { data, loading, error, reload } = useApiData<TrackingSettingsResponse>("/api/settings/tracking");
  if (!data && loading) {
    return (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]" aria-busy="true">
        <Skeleton className="h-96 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }
  if (!data) return <LoadError what="tracking page settings" error={error ?? "Unknown error"} onRetry={() => void reload()} />;
  // Remount when the saved settings change so the form starts from them.
  return <TrackingForm key={JSON.stringify(data.settings)} data={data} reload={reload} />;
}
