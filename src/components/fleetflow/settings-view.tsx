"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, CreditCard, KeyRound, LoaderCircle, RefreshCw, Rocket, UserPlus, Users } from "lucide-react";

import { TemporaryPasswordDialog } from "@/components/fleetflow/change-password-dialog";
import { PlanPanel } from "@/components/fleetflow/plan-panel";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, useApiData } from "@/lib/api-client";
import { initials, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createStaffSchema, updateOrgSchema } from "@/lib/validation";
import type { OnboardingData, OrgSettings, StaffItem, StaffList, TempPasswordResult } from "@/lib/types-org";
import { useAppStore, type SettingsTab } from "@/store/app-store";

// ── shared bits ──────────────────────────────────────────────

const DEACTIVATE_ACTION_CLASSES =
  "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/30 dark:bg-rose-600 dark:hover:bg-rose-700";

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

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-rose-600 dark:text-rose-400">
      {message}
    </p>
  );
}

function ServerError({ message }: { message: string | null }) {
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

function errorProps(id: string, message?: string) {
  return message ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};
}

function issuesByField<K extends string>(issues: { path: PropertyKey[]; message: string }[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const issue of issues) {
    const key = issue.path[0] as K;
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

function LoadError({ what, error, onRetry }: { what: string; error: string; onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <p className="text-sm text-destructive">
        Failed to load {what}: {error}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw aria-hidden /> Try again
      </Button>
    </Card>
  );
}

// ── Company tab ──────────────────────────────────────────────

type OrgField = "name" | "phone" | "contactEmail" | "address" | "defaultPickupAddress" | "timezone";
type OrgForm = Record<OrgField, string>;

function toForm(o: OrgSettings): OrgForm {
  return {
    name: o.name,
    phone: o.phone ?? "",
    contactEmail: o.contactEmail ?? "",
    address: o.address ?? "",
    defaultPickupAddress: o.defaultPickupAddress ?? "",
    timezone: o.timezone,
  };
}

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
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="org-name">Company name</Label>
          <Input id="org-name" value={form.name} onChange={field("name")} maxLength={120} {...errorProps("org-name", errors.name)} />
          <FieldError id="org-name-error" message={errors.name} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-phone">Phone</Label>
          <Input
            id="org-phone"
            type="tel"
            value={form.phone}
            onChange={field("phone")}
            placeholder="+880 1XXX-XXXXXX"
            maxLength={30}
            {...errorProps("org-phone", errors.phone)}
          />
          <FieldError id="org-phone-error" message={errors.phone} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-email">Contact email</Label>
          <Input
            id="org-email"
            type="email"
            value={form.contactEmail}
            onChange={field("contactEmail")}
            placeholder="orders@company.com"
            maxLength={254}
            {...errorProps("org-email", errors.contactEmail)}
          />
          <FieldError id="org-email-error" message={errors.contactEmail} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="org-address">Business address</Label>
          <Textarea
            id="org-address"
            rows={2}
            value={form.address}
            onChange={field("address")}
            placeholder="e.g. House 12, Road 5, Mirpur DOHS, Dhaka"
            maxLength={300}
            {...errorProps("org-address", errors.address)}
          />
          <FieldError id="org-address-error" message={errors.address} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="org-pickup">Default pickup address</Label>
          <Textarea
            id="org-pickup"
            rows={2}
            value={form.defaultPickupAddress}
            onChange={field("defaultPickupAddress")}
            placeholder="Your warehouse or depot — prefilled on every new delivery"
            maxLength={300}
            {...errorProps("org-pickup", errors.defaultPickupAddress)}
          />
          <FieldError id="org-pickup-error" message={errors.defaultPickupAddress} />
          <p className="text-xs text-muted-foreground">Prefilled as the pickup address when you create a delivery. You can still change it per order.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-timezone">Timezone</Label>
          <Select value={form.timezone} onValueChange={(v) => setForm((f) => ({ ...f, timezone: v }))}>
            <SelectTrigger id="org-timezone" className="w-full" {...errorProps("org-timezone", errors.timezone)}>
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
          <p className="text-xs text-muted-foreground">Used for CSV import dates and monthly plan usage.</p>
        </div>
      </div>
      <ServerError message={serverError} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => setForm(toForm(org))} className="min-h-11 sm:min-h-9">
          Discard changes
        </Button>
        <Button type="submit" disabled={!dirty || saving} className="min-h-11 sm:min-h-9">
          {saving && <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden />}
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

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
    <Card>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Rocket className="size-4.5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium">Getting-started checklist</div>
            <p className="text-xs text-muted-foreground">
              {data.dismissed ? "Hidden from the dashboard." : "Shown at the top of the dashboard until every step is done."}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void set(!data.dismissed)} className="min-h-11 sm:min-h-8">
          {data.dismissed ? "Show on dashboard" : "Hide from dashboard"}
        </Button>
      </CardContent>
    </Card>
  );
}

function CompanyTab() {
  const { data, loading, error, reload } = useApiData<{ organization: OrgSettings }>("/api/org");
  const org = data?.organization;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company profile</CardTitle>
          <CardDescription className="text-xs">How your business appears to your team, and the defaults used when creating deliveries.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !org ? (
            <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={cn("space-y-2", i === 0 || i === 3 || i === 4 ? "sm:col-span-2" : "")}>
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ))}
            </div>
          ) : error && !org ? (
            <LoadError what="company settings" error={error} onRetry={reload} />
          ) : org ? (
            <CompanyForm key={JSON.stringify(toForm(org))} org={org} />
          ) : null}
        </CardContent>
      </Card>
      <ChecklistToggle />
    </div>
  );
}

// ── Team tab ─────────────────────────────────────────────────

type StaffField = "name" | "email";

function AddStaffDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: { name: string; email: string; password: string }) => void;
}) {
  const [form, setForm] = useState({ name: "", email: "" });
  const [errors, setErrors] = useState<Partial<Record<StaffField, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const field = (key: StaffField) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((errs) => (errs[key] ? { ...errs, [key]: undefined } : errs));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = createStaffSchema.safeParse(form);
    setServerError(null);
    if (!parsed.success) {
      setErrors(issuesByField<StaffField>(parsed.error.issues));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const res = await api.post<TempPasswordResult>("/api/staff", { name: parsed.data.name, email: parsed.data.email });
      toast.success(`Dispatcher account created for ${parsed.data.name}`);
      useAppStore.getState().bump();
      onCreated({ name: parsed.data.name, email: parsed.data.email, password: res.temporaryPassword });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Failed to add team member");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a dispatcher</DialogTitle>
          <DialogDescription>
            They get full admin access to dispatch, drivers and settings. We&apos;ll generate a temporary password for you to share.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="staff-name">Full name</Label>
            <Input id="staff-name" value={form.name} onChange={field("name")} maxLength={120} placeholder="e.g. Nusrat Jahan" {...errorProps("staff-name", errors.name)} />
            <FieldError id="staff-name-error" message={errors.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-email">Email</Label>
            <Input
              id="staff-email"
              type="email"
              autoComplete="off"
              value={form.email}
              onChange={field("email")}
              maxLength={254}
              placeholder="name@company.com"
              {...errorProps("staff-email", errors.email)}
            />
            <FieldError id="staff-email-error" message={errors.email} />
          </div>
          <ServerError message={serverError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} className="min-h-11 sm:min-h-9">
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="min-h-11 sm:min-h-9">
              {submitting ? "Adding…" : "Add dispatcher"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type PendingAction = { member: StaffItem; action: "deactivate" | "reset-password" };

function TeamTab() {
  const { data, loading, error, reload } = useApiData<StaffList>("/api/staff");
  const [addOpen, setAddOpen] = useState(false);
  const [addSeq, setAddSeq] = useState(0);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<{ name: string; email: string; password: string } | null>(null);

  const items = data?.items ?? [];
  const atLimit = data ? data.limit !== null && data.activeCount >= data.limit : false;

  const run = async (member: StaffItem, action: "activate" | "deactivate" | "reset-password") => {
    setBusyId(member.id);
    try {
      const res = await api.patch<{ temporaryPassword?: string }>(`/api/staff/${member.id}`, { action });
      setPending(null);
      if (action === "reset-password" && res.temporaryPassword) {
        setTempPassword({ name: member.name, email: member.email, password: res.temporaryPassword });
        toast.success(`${member.name}'s password was reset and they were signed out`);
      } else {
        toast.success(action === "activate" ? `${member.name} reactivated` : `${member.name} deactivated and signed out`);
      }
      useAppStore.getState().bump();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update team member");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Dispatchers &amp; admins</CardTitle>
            <CardDescription className="text-xs">
              People who can dispatch, manage drivers and change settings.
              {data && (
                <>
                  {" "}
                  {data.activeCount} active
                  {data.limit !== null ? ` of ${data.limit} allowed on your plan` : " — unlimited on your plan"}.
                </>
              )}
            </CardDescription>
          </div>
          <Button
            onClick={() => {
              setAddSeq((n) => n + 1);
              setAddOpen(true);
            }}
            disabled={!data || atLimit}
            title={atLimit ? "Your plan's dispatcher limit is reached — upgrade to add more" : undefined}
            className="min-h-11 sm:min-h-9"
          >
            <UserPlus aria-hidden /> Add dispatcher
          </Button>
        </CardHeader>
        <CardContent>
          {atLimit && (
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              You&apos;ve reached your plan&apos;s dispatcher limit. Deactivate someone or upgrade under “Plan &amp; billing” to add more.
            </p>
          )}
          {loading && !data ? (
            <div className="space-y-3" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-9 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : error && !data ? (
            <LoadError what="your team" error={error} onRetry={reload} />
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Users className="mx-auto mb-2 size-8 opacity-50" aria-hidden /> No team members yet.
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((m) => (
                <li key={m.id} className={cn("flex flex-col gap-3 py-3 sm:flex-row sm:items-center", !m.active && "opacity-60")}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar className="size-9 shrink-0">
                      <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">{initials(m.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{m.name}</span>
                        {m.isYou && (
                          <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
                            You
                          </Badge>
                        )}
                        {!m.active && (
                          <Badge variant="outline" className="border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
                            Deactivated
                          </Badge>
                        )}
                        {m.active && m.mustChangePassword && (
                          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                            Temporary password
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.email} · {m.lastLoginAt ? `last signed in ${timeAgo(m.lastLoginAt)}` : "never signed in"}
                      </p>
                    </div>
                  </div>
                  {!m.isYou && (
                    <div className="flex shrink-0 flex-wrap gap-2 pl-12 sm:pl-0">
                      {m.active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busyId === m.id}
                          onClick={() => setPending({ member: m, action: "reset-password" })}
                          className="min-h-11 sm:min-h-8"
                        >
                          <KeyRound aria-hidden /> Reset password
                        </Button>
                      )}
                      {m.active ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === m.id}
                          onClick={() => setPending({ member: m, action: "deactivate" })}
                          className="min-h-11 sm:min-h-8"
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" disabled={busyId === m.id} onClick={() => void run(m, "activate")} className="min-h-11 sm:min-h-8">
                          {busyId === m.id ? "Reactivating…" : "Reactivate"}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AddStaffDialog
        key={`add-staff-${addSeq}`}
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(result) => {
          setAddOpen(false);
          setTempPassword(result);
        }}
      />

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && !busyId && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.action === "deactivate" ? `Deactivate ${pending.member.name}?` : `Reset ${pending?.member.name}’s password?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.action === "deactivate"
                ? "They will be signed out immediately and can't sign in until reactivated. Their history stays in the audit log."
                : "A new temporary password will be generated and shown once. They'll be signed out everywhere and must choose their own password at next sign-in."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 sm:min-h-9" disabled={!!busyId}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!!busyId}
              className={pending?.action === "deactivate" ? DEACTIVATE_ACTION_CLASSES : undefined}
              onClick={(e) => {
                e.preventDefault(); // stay open until the request finishes
                if (pending) void run(pending.member, pending.action);
              }}
            >
              {busyId ? "Working…" : pending?.action === "deactivate" ? "Deactivate" : "Reset password"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TemporaryPasswordDialog result={tempPassword} onClose={() => setTempPassword(null)} />
    </div>
  );
}

// ── main view ────────────────────────────────────────────────

export function SettingsView() {
  const [tab, setTab] = useState<SettingsTab>(() => useAppStore.getState().settingsTabPreset ?? "company");

  // The preset is one-shot: consume it once this view has picked it up.
  useEffect(() => {
    useAppStore.getState().setSettingsTabPreset(null);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">Your company profile, team access and subscription.</p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as SettingsTab)} className="gap-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="company">
            <Building2 aria-hidden /> Company
          </TabsTrigger>
          <TabsTrigger value="team">
            <Users aria-hidden /> Team
          </TabsTrigger>
          <TabsTrigger value="plan">
            <CreditCard aria-hidden /> Plan &amp; billing
          </TabsTrigger>
        </TabsList>
        <TabsContent value="company">
          <CompanyTab />
        </TabsContent>
        <TabsContent value="team">
          <TeamTab />
        </TabsContent>
        <TabsContent value="plan">
          <PlanPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default SettingsView;
