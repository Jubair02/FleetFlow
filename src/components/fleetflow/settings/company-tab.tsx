"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  CheckCircle2,
  Clock,
  Globe2,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  Rocket,
  Store,
  Warehouse,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, useApiData } from "@/lib/api-client";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { updateOrgSchema } from "@/lib/validation";
import type { OnboardingData, OrgSettings } from "@/lib/types-org";
import { useAppStore } from "@/store/app-store";
import {
  FieldError,
  IconChip,
  LoadError,
  PANEL,
  ServerError,
  SettingsSection,
  WithIcon,
  errorProps,
  issuesByField,
} from "./shared";

/** Common zones for our customers; any other valid zone already saved is kept in the list. */
const TIMEZONES = [
  { value: "Asia/Dhaka", label: "Bangladesh — Asia/Dhaka (UTC+6)" },
  { value: "Asia/Kolkata", label: "India — Asia/Kolkata (UTC+5:30)" },
  { value: "Asia/Kathmandu", label: "Nepal — Asia/Kathmandu (UTC+5:45)" },
  { value: "Asia/Karachi", label: "Pakistan — Asia/Karachi (UTC+5)" },
  { value: "Asia/Dubai", label: "UAE — Asia/Dubai (UTC+4)" },
  { value: "Asia/Singapore", label: "Singapore — Asia/Singapore (UTC+8)" },
  { value: "Asia/Kuala_Lumpur", label: "Malaysia — Asia/Kuala_Lumpur (UTC+8)" },
  { value: "Europe/London", label: "UK — Europe/London" },
  { value: "UTC", label: "UTC" },
];

type OrgField = "name" | "phone" | "contactEmail" | "address" | "defaultPickupAddress" | "timezone";
type OrgForm = Record<OrgField, string>;

/** Optional details counted by the hero's "profile complete" summary. */
export const PROFILE_DETAILS = ["phone", "contactEmail", "address", "defaultPickupAddress"] as const;

export function toForm(o: OrgSettings): OrgForm {
  return {
    name: o.name,
    phone: o.phone ?? "",
    contactEmail: o.contactEmail ?? "",
    address: o.address ?? "",
    defaultPickupAddress: o.defaultPickupAddress ?? "",
    timezone: o.timezone,
  };
}

// ── live preview ─────────────────────────────────────────────

function PreviewLine({ icon: Icon, value, empty }: { icon: typeof Phone; value: string; empty: string }) {
  const v = value.trim();
  return (
    <li className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className={cn("min-w-0 text-sm break-words", !v && "text-muted-foreground italic")}>{v || empty}</span>
    </li>
  );
}

/** What recipients see on their tracking page (name + phone), plus the rest of the profile at a glance. */
function CustomerPreview({ form }: { form: OrgForm }) {
  const name = form.name.trim() || "Your company";
  const phone = form.phone.trim();
  const zone = TIMEZONES.find((t) => t.value === form.timezone)?.label ?? form.timezone;

  return (
    <div className={cn(PANEL, "p-5")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Live preview</p>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> Updates as you type
        </span>
      </div>

      {/* mini tracking-page sender card */}
      <div className="relative isolate mt-3 overflow-hidden rounded-xl bg-gradient-to-br from-emerald-800 via-emerald-700 to-teal-700 p-4 text-white dark:from-emerald-950 dark:via-emerald-900 dark:to-teal-900 dark:ring-1 dark:ring-white/10">
        <div
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(90%_70%_at_100%_0%,rgb(255_255_255/0.2),transparent_60%)]"
          aria-hidden="true"
        />
        <p className="text-[11px] font-medium tracking-wider text-white/80 uppercase">Tracking page</p>
        <div className="mt-3 flex items-center gap-3">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-sm font-semibold ring-1 ring-inset ring-white/25"
            aria-hidden="true"
          >
            {initials(name) || <Store className="size-5" />}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{name}</p>
            <p className="truncate text-xs text-white/85">{phone ? `Questions? Call ${phone}` : "No phone — recipients can't call you"}</p>
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Recipients see your company name and phone number on their tracking link.</p>

      <ul className="mt-4 space-y-2.5 border-t pt-4">
        <PreviewLine icon={Mail} value={form.contactEmail} empty="No contact email" />
        <PreviewLine icon={MapPin} value={form.address} empty="No business address" />
        <PreviewLine icon={Warehouse} value={form.defaultPickupAddress} empty="No default pickup" />
        <PreviewLine icon={Clock} value={zone} empty="No timezone" />
      </ul>
    </div>
  );
}

// ── checklist preference ─────────────────────────────────────

function ChecklistToggle() {
  const { data, reload } = useApiData<OnboardingData>("/api/onboarding");
  const [busy, setBusy] = useState(false);
  if (!data || data.allDone) return null;

  const set = async (dismissed: boolean) => {
    setBusy(true);
    try {
      await api.post("/api/onboarding", { dismissed });
      toast.success(dismissed ? "Checklist hidden from the dashboard" : "Checklist is back on your dashboard");
      useAppStore.getState().bump();
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the checklist");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn(PANEL, "flex flex-col gap-3 p-5")}>
      <div className="flex items-start gap-3">
        <IconChip icon={Rocket} />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Getting-started checklist</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {data.dismissed ? "Hidden from the dashboard." : "Shown at the top of the dashboard until every step is done."}
          </p>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void set(!data.dismissed)} className="min-h-11 w-full sm:min-h-8">
        {data.dismissed ? "Show on dashboard" : "Hide from dashboard"}
      </Button>
    </div>
  );
}

// ── form ─────────────────────────────────────────────────────

const LAYOUT = "grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]";

/** Remounted (via `key`) whenever the saved organization changes, so the form starts from it. */
function CompanyForm({ org }: { org: OrgSettings }) {
  const [form, setForm] = useState<OrgForm>(() => toForm(org));
  const [errors, setErrors] = useState<Partial<Record<OrgField, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const initial = toForm(org);
  const dirty = (Object.keys(initial) as OrgField[]).some((k) => form[k].trim() !== initial[k]);
  const zones = TIMEZONES.some((t) => t.value === form.timezone) ? TIMEZONES : [{ value: form.timezone, label: form.timezone }, ...TIMEZONES];

  const field = (key: OrgField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((errs) => (errs[key] ? { ...errs, [key]: undefined } : errs));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = updateOrgSchema.safeParse(form);
    setServerError(null);
    if (!parsed.success) {
      setErrors(issuesByField<OrgField>(parsed.error.issues));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await api.patch<{ organization: OrgSettings }>("/api/org", parsed.data);
      const { session, setSession, bump } = useAppStore.getState();
      if (session && parsed.data.name) setSession({ ...session, organizationName: parsed.data.name });
      toast.success("Company settings saved");
      bump();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={LAYOUT}>
      <form onSubmit={submit} noValidate className={cn(PANEL, "min-w-0")} aria-label="Company profile">
        <div className="divide-y">
          <SettingsSection icon={Building2} title="Identity" description="Your company name across FleetFlow and on every tracking link.">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="org-name">Company name</Label>
              <WithIcon icon={Building2}>
                <Input id="org-name" value={form.name} onChange={field("name")} maxLength={120} className="pl-9" {...errorProps("org-name", errors.name)} />
              </WithIcon>
              <FieldError id="org-name-error" message={errors.name} />
            </div>
          </SettingsSection>

          <SettingsSection icon={Phone} title="Contact" description="How recipients and the FleetFlow team reach you. Invoices go to the contact email.">
            <div className="space-y-1.5">
              <Label htmlFor="org-phone">Phone</Label>
              <WithIcon icon={Phone}>
                <Input
                  id="org-phone"
                  type="tel"
                  value={form.phone}
                  onChange={field("phone")}
                  placeholder="+880 1XXX-XXXXXX"
                  maxLength={30}
                  className="pl-9"
                  {...errorProps("org-phone", errors.phone)}
                />
              </WithIcon>
              <FieldError id="org-phone-error" message={errors.phone} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-email">Contact email</Label>
              <WithIcon icon={Mail}>
                <Input
                  id="org-email"
                  type="email"
                  value={form.contactEmail}
                  onChange={field("contactEmail")}
                  placeholder="orders@company.com"
                  maxLength={254}
                  className="pl-9"
                  {...errorProps("org-email", errors.contactEmail)}
                />
              </WithIcon>
              <FieldError id="org-email-error" message={errors.contactEmail} />
            </div>
          </SettingsSection>

          <SettingsSection icon={MapPin} title="Locations" description="Your office, and the depot new deliveries start from.">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="org-address">Business address</Label>
              <WithIcon icon={MapPin} multiline>
                <Textarea
                  id="org-address"
                  rows={2}
                  value={form.address}
                  onChange={field("address")}
                  placeholder="e.g. House 12, Road 5, Mirpur DOHS, Dhaka"
                  maxLength={300}
                  className="pl-9"
                  {...errorProps("org-address", errors.address)}
                />
              </WithIcon>
              <FieldError id="org-address-error" message={errors.address} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="org-pickup">Default pickup address</Label>
              <WithIcon icon={Warehouse} multiline>
                <Textarea
                  id="org-pickup"
                  rows={2}
                  value={form.defaultPickupAddress}
                  onChange={field("defaultPickupAddress")}
                  placeholder="Your warehouse or depot — prefilled on every new delivery"
                  maxLength={300}
                  className="pl-9"
                  aria-describedby={errors.defaultPickupAddress ? "org-pickup-error org-pickup-hint" : "org-pickup-hint"}
                  aria-invalid={errors.defaultPickupAddress ? true : undefined}
                />
              </WithIcon>
              <FieldError id="org-pickup-error" message={errors.defaultPickupAddress} />
              <p id="org-pickup-hint" className="text-xs text-muted-foreground">
                Prefilled as the pickup address when you create a delivery. You can still change it per order.
              </p>
            </div>
          </SettingsSection>

          <SettingsSection icon={Globe2} title="Region" description="Used for CSV import dates and monthly plan usage.">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="org-timezone">Timezone</Label>
              <Select value={form.timezone} onValueChange={(v) => setForm((f) => ({ ...f, timezone: v }))}>
                <SelectTrigger id="org-timezone" className="w-full justify-start sm:max-w-sm [&>svg:last-child]:ml-auto" {...errorProps("org-timezone", errors.timezone)}>
                  <Clock className="text-muted-foreground" aria-hidden="true" />
                  <SelectValue placeholder="Select a timezone" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={z.value} value={z.value}>
                      {z.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError id="org-timezone-error" message={errors.timezone} />
            </div>
          </SettingsSection>
        </div>

        {serverError && (
          <div className="px-5 pb-4 sm:px-6">
            <ServerError message={serverError} />
          </div>
        )}

        {/* save bar: once there are unsaved changes it sticks to the bottom of the viewport */}
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
            <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => setForm(toForm(org))} className="min-h-11 sm:min-h-9">
              Discard
            </Button>
            <Button type="submit" disabled={!dirty || saving} className="min-h-11 sm:min-h-9">
              {saving && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </form>

      <aside className="grid gap-4 sm:grid-cols-2 xl:sticky xl:top-20 xl:grid-cols-1" aria-label="Preview and preferences">
        <CustomerPreview form={form} />
        <ChecklistToggle />
      </aside>
    </div>
  );
}

function CompanySkeleton() {
  return (
    <div className={LAYOUT} aria-busy="true">
      <div className={cn(PANEL, "divide-y")}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="grid gap-4 px-5 py-6 sm:px-6 lg:grid-cols-[14rem_1fr] lg:gap-8">
            <div className="flex gap-3">
              <Skeleton className="size-9 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}

export function CompanyTab({
  org,
  loading,
  error,
  reload,
}: {
  org: OrgSettings | undefined;
  loading: boolean;
  error: string | null;
  reload: () => void;
}) {
  if (loading && !org) return <CompanySkeleton />;
  if (error && !org) return <LoadError what="company settings" error={error} onRetry={reload} />;
  if (!org) return null;
  return <CompanyForm key={JSON.stringify(toForm(org))} org={org} />;
}
