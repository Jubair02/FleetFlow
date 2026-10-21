"use client";

import { useState } from "react";
import {
  Activity,
  Ban,
  CreditCard,
  History,
  LoaderCircle,
  Pencil,
  PlayCircle,
  ScrollText,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { getPlan, RESOURCE_LABELS, type PlanCode, type PlanResource } from "@/lib/plan-catalog";
import type { OrgAction, PlatformOrgDetail, SubscriptionStatus } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useConsole } from "./console-context";
import { bumpPlatformData, platformApi, usePlatformData } from "./platform-api";
import {
  Callout,
  ConfirmDialog,
  CopyIdButton,
  EmptyState,
  ErrorState,
  errorProps,
  FieldError,
  formatBdt,
  humanizeAction,
  OrgStatusBadge,
  parseDetail,
  PLAN_CODES,
  PlanBadge,
  RoleBadge,
  ServerError,
  SUBSCRIPTION_LABELS,
  SUBSCRIPTION_STATUSES,
  SubscriptionBadge,
  UsageBar,
  UserStatusBadge,
} from "./shared";

const RESOURCE_ORDER: PlanResource[] = ["monthlyDeliveries", "drivers", "vehicles", "admins"];
const USERS_PREVIEW = 8;

type DialogKind = "suspend" | "reactivate" | "plan" | "subscription" | null;

async function patchOrg(id: string, body: OrgAction) {
  await platformApi.patch(`/api/platform/organizations/${encodeURIComponent(id)}`, body);
  bumpPlatformData();
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Organization detail panel — opened from any console view via openOrg(id). */
export function OrgDetailSheet({ orgId, onClose }: { orgId: string | null; onClose: () => void }) {
  return (
    <Sheet open={orgId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {orgId ? <OrgDetailBody key={orgId} orgId={orgId} /> : <SheetTitle className="sr-only">Organization</SheetTitle>}
      </SheetContent>
    </Sheet>
  );
}

function OrgDetailBody({ orgId }: { orgId: string }) {
  const { showOrgUsers, showOrgAudit } = useConsole();
  const { data, error, reload } = usePlatformData<PlatformOrgDetail>(`/api/platform/organizations/${encodeURIComponent(orgId)}`);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [dialogSeq, setDialogSeq] = useState(0);
  const open = (kind: DialogKind) => {
    setDialogSeq((n) => n + 1);
    setDialog(kind);
  };

  if (error && !data) {
    return (
      <div className="p-6">
        <SheetTitle className="mb-4">Organization</SheetTitle>
        <ErrorState title="Couldn't load this organization" message={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-4 p-6" aria-busy="true">
        <SheetTitle className="sr-only">Loading organization</SheetTitle>
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const org = data.organization;
  const suspended = org.status === "SUSPENDED";
  const ref = { id: org.id, name: org.name };

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 border-b bg-background/95 px-6 pb-4 pt-5 pr-14 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <SheetTitle className="text-lg">{org.name}</SheetTitle>
        <SheetDescription asChild>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <OrgStatusBadge status={org.status} />
            <PlanBadge plan={org.plan} />
            <SubscriptionBadge status={org.subscriptionStatus} />
            <CopyIdButton id={org.id} label="organization ID" />
          </div>
        </SheetDescription>
        <div className="mt-3 flex flex-wrap gap-2">
          {suspended ? (
            <Button size="sm" onClick={() => open("reactivate")}>
              <PlayCircle aria-hidden /> Reactivate
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="text-rose-700 hover:text-rose-800 dark:text-rose-400" onClick={() => open("suspend")}>
              <Ban aria-hidden /> Suspend
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => open("plan")}>
            <CreditCard aria-hidden /> Change plan
          </Button>
          <Button size="sm" variant="outline" onClick={() => showOrgUsers(ref)}>
            <Users aria-hidden /> Users
          </Button>
          <Button size="sm" variant="outline" onClick={() => showOrgAudit(ref)}>
            <ScrollText aria-hidden /> Platform audit
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-6">
        {error && <ErrorState title="Showing the last loaded details" message={error} onRetry={reload} />}

        {suspended && (
          <Callout tone="rose" className="text-sm">
            <div className="font-medium">Suspended {org.suspendedAt ? `on ${formatDateTime(org.suspendedAt)}` : ""}</div>
            <div className="mt-0.5">Reason: {org.suspendedReason || "—"}</div>
            <div className="mt-1 text-xs opacity-90">Staff and drivers cannot sign in. Customer tracking links keep working.</div>
          </Callout>
        )}

        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Profile</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <dl className="divide-y">
              <DetailRow label="Contact email">{org.contactEmail || "—"}</DetailRow>
              <DetailRow label="Phone">{org.phone || "—"}</DetailRow>
              <DetailRow label="Address">{org.address || "—"}</DetailRow>
              <DetailRow label="Timezone">{org.timezone}</DetailRow>
              <DetailRow label="Created">{formatDateTime(org.createdAt)}</DetailRow>
            </dl>
          </CardContent>
        </Card>

        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Plan &amp; subscription</CardTitle>
            <CardAction>
              <Button size="sm" variant="ghost" onClick={() => open("subscription")} aria-label="Edit subscription record">
                <Pencil aria-hidden /> Edit
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 px-4">
            <dl className="divide-y">
              <DetailRow label="Plan">
                {getPlan(org.plan).name}
                {getPlan(org.plan).proposedPriceBdt != null && (
                  <span className="text-muted-foreground"> · {formatBdt(getPlan(org.plan).proposedPriceBdt!)}/mo proposed</span>
                )}
              </DetailRow>
              <DetailRow label="Subscription">{SUBSCRIPTION_LABELS[org.subscriptionStatus] ?? org.subscriptionStatus}</DetailRow>
              <DetailRow label="Paid until">{org.paidUntil ? formatDate(org.paidUntil) : "—"}</DetailRow>
              <DetailRow label="Billing notes">
                <span className="whitespace-pre-wrap">{org.billingNotes || "—"}</span>
              </DetailRow>
            </dl>
            <p className="text-[11px] text-muted-foreground">Subscription details are recorded manually — no payment is processed by FleetFlow.</p>
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">Usage vs plan limits</div>
              <ul className="flex flex-col gap-3">
                {RESOURCE_ORDER.map((r) => (
                  <UsageBar key={r} label={RESOURCE_LABELS[r]} used={data.usage[r] ?? 0} limit={data.limits[r] ?? null} />
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Users ({data.users.length})</CardTitle>
            <CardAction>
              <Button size="sm" variant="ghost" onClick={() => showOrgUsers(ref)}>
                Manage in Users
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-4">
            {data.users.length === 0 ? (
              <EmptyState icon={Users} title="No users" />
            ) : (
              <ul className="divide-y">
                {data.users.slice(0, USERS_PREVIEW).map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{u.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {u.email} · last sign-in {u.lastLoginAt ? timeAgo(u.lastLoginAt) : "never"}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <RoleBadge role={u.role} />
                      <UserStatusBadge active={u.active} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {data.users.length > USERS_PREVIEW && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing {USERS_PREVIEW} of {data.users.length}. Open Users to see and manage all of them.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Recent company activity</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            {data.recentActivity.length === 0 ? (
              <EmptyState icon={Activity} title="No activity recorded" />
            ) : (
              <ul className="divide-y">
                {data.recentActivity.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{humanizeAction(a.action)}</span>
                      <span className="text-muted-foreground"> · {a.entityType}</span>
                      <div className="text-xs text-muted-foreground">{a.actorName ?? "System"}</div>
                    </div>
                    <time className="shrink-0 text-xs text-muted-foreground" dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>
                      {timeAgo(a.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Platform actions</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            {data.platformActions.length === 0 ? (
              <EmptyState icon={History} title="No platform actions yet" description="Suspensions, plan changes and resets by FleetFlow staff appear here." />
            ) : (
              <ul className="divide-y">
                {data.platformActions.map((a) => {
                  const detail = parseDetail(a.detail);
                  return (
                    <li key={a.id} className="py-2 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="font-medium">{humanizeAction(a.action)}</span>
                          <span className="text-muted-foreground"> · by {a.actorName ?? "System"}</span>
                        </div>
                        <time className="shrink-0 text-xs text-muted-foreground" dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>
                          {timeAgo(a.createdAt)}
                        </time>
                      </div>
                      {detail && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {typeof detail === "string" ? detail : detail.map((d) => `${d.key}: ${d.value}`).join(" · ")}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <SuspendDialog key={`s-${dialogSeq}`} open={dialog === "suspend"} onOpenChange={(o) => !o && setDialog(null)} orgId={org.id} orgName={org.name} />
      <ConfirmDialog
        key={`r-${dialogSeq}`}
        open={dialog === "reactivate"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Reactivate ${org.name}?`}
        description="Staff and drivers can sign in again straight away. Their data is exactly as it was when the organization was suspended."
        confirmLabel="Reactivate"
        onConfirm={async () => {
          await patchOrg(org.id, { action: "reactivate" });
          toast.success(`${org.name} reactivated`);
        }}
      />
      <ChangePlanDialog key={`p-${dialogSeq}`} open={dialog === "plan"} onOpenChange={(o) => !o && setDialog(null)} detail={data} />
      <SubscriptionDialog key={`sub-${dialogSeq}`} open={dialog === "subscription"} onOpenChange={(o) => !o && setDialog(null)} detail={data} />
    </div>
  );
}

// ── Suspend ──────────────────────────────────────────────────

const SUSPEND_REASON_MAX = 300;

function SuspendDialog({ open, onOpenChange, orgId, orgName }: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string; orgName: string }) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const trimmed = reason.trim();
  const invalid = trimmed.length < 3 ? "Enter a reason (at least 3 characters) — it is shown in the audit log" : undefined;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Suspend ${orgName}?`}
      destructive
      confirmLabel="Suspend organization"
      canConfirm={!invalid}
      description={
        <ul className="ml-4 list-disc space-y-1">
          <li>All staff and drivers are signed out immediately and cannot sign in or use the app.</li>
          <li>No data is deleted.</li>
          <li>Customer tracking links keep working.</li>
          <li>Other organizations are not affected.</li>
          <li>You can reactivate it at any time.</li>
        </ul>
      }
      onConfirm={async () => {
        await patchOrg(orgId, { action: "suspend", reason: trimmed });
        toast.success(`${orgName} suspended`);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="suspend-reason">Reason</Label>
        <Textarea
          id="suspend-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          maxLength={SUSPEND_REASON_MAX}
          rows={3}
          placeholder="e.g. Unpaid invoice for September; requested by owner"
          {...errorProps("suspend-reason", touched ? invalid : undefined)}
        />
        <div className="flex justify-between gap-2">
          <FieldError id="suspend-reason-error" message={touched ? invalid : undefined} />
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
            {reason.length}/{SUSPEND_REASON_MAX}
          </span>
        </div>
      </div>
    </ConfirmDialog>
  );
}

// ── Change plan ──────────────────────────────────────────────

function ChangePlanDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (o: boolean) => void; detail: PlatformOrgDetail }) {
  const org = detail.organization;
  const currentCode = getPlan(org.plan).code;
  const [plan, setPlan] = useState<PlanCode>(currentCode);
  const next = getPlan(plan);
  const overLimits = RESOURCE_ORDER.filter((r) => {
    const limit = next.limits[r];
    return limit !== null && (detail.usage[r] ?? 0) > limit;
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Change plan for ${org.name}`}
      confirmLabel="Change plan"
      canConfirm={plan !== org.plan}
      description="Plan limits apply to new additions only. Existing drivers, vehicles, admins and deliveries are never removed or disabled."
      onConfirm={async () => {
        await patchOrg(org.id, { action: "set-plan", plan });
        toast.success(`${org.name} moved to ${next.name}`);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="plan-select">New plan</Label>
        <Select value={plan} onValueChange={(v) => setPlan(v as PlanCode)}>
          <SelectTrigger id="plan-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLAN_CODES.map((c) => {
              const p = getPlan(c);
              return (
                <SelectItem key={c} value={c}>
                  {p.name}
                  {p.proposedPriceBdt != null ? ` — ${formatBdt(p.proposedPriceBdt)}/mo (proposed)` : " — free"}
                  {c === currentCode ? " · current" : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border bg-muted/30 p-3 text-xs">
        {RESOURCE_ORDER.map((r) => (
          <li key={r} className="flex justify-between gap-2">
            <span className="text-muted-foreground first-letter:uppercase">{RESOURCE_LABELS[r]}</span>
            <span className="tabular-nums">
              {detail.usage[r] ?? 0} / {next.limits[r] ?? "∞"}
            </span>
          </li>
        ))}
      </ul>
      {overLimits.length > 0 && (
        <Callout>
          Current usage is above the {next.name} limit for {overLimits.map((r) => RESOURCE_LABELS[r]).join(", ")}. Nothing is removed, but the
          company can&apos;t add more of these until usage drops or the plan is raised.
        </Callout>
      )}
      <p className="text-[11px] text-muted-foreground">No payment is processed — this only changes the recorded plan and its limits.</p>
    </ConfirmDialog>
  );
}

// ── Subscription record ──────────────────────────────────────

const NOTES_MAX = 1000;

function SubscriptionDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (o: boolean) => void; detail: PlatformOrgDetail }) {
  const org = detail.organization;
  const [status, setStatus] = useState<SubscriptionStatus>(org.subscriptionStatus);
  const [paidUntil, setPaidUntil] = useState(org.paidUntil ? org.paidUntil.slice(0, 10) : "");
  const [notes, setNotes] = useState(org.billingNotes ?? "");
  const [errors, setErrors] = useState<{ paidUntil?: string; notes?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    if (paidUntil && !/^\d{4}-\d{2}-\d{2}$/.test(paidUntil)) found.paidUntil = "Enter a valid date";
    if (notes.length > NOTES_MAX) found.notes = `Notes must be ${NOTES_MAX} characters or fewer`;
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length) return;
    setSubmitting(true);
    try {
      await patchOrg(org.id, {
        action: "update-subscription",
        subscriptionStatus: status,
        paidUntil: paidUntil ? new Date(`${paidUntil}T00:00:00.000Z`).toISOString() : null,
        billingNotes: notes.trim() ? notes.trim() : null,
      });
      toast.success("Subscription record updated");
      onOpenChange(false);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not update the subscription");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit subscription record</DialogTitle>
          <DialogDescription>{org.name}</DialogDescription>
        </DialogHeader>
        <Callout>Recorded manually — no payment is processed. Use this to note what was agreed and paid outside FleetFlow (see docs/BILLING.md).</Callout>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="sub-status">Subscription status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as SubscriptionStatus)} disabled={submitting}>
              <SelectTrigger id="sub-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUBSCRIPTION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SUBSCRIPTION_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sub-paid">
              Paid until <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <div className="flex gap-2">
              <Input id="sub-paid" type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} disabled={submitting} {...errorProps("sub-paid", errors.paidUntil)} />
              {paidUntil && (
                <Button type="button" variant="ghost" onClick={() => setPaidUntil("")} disabled={submitting}>
                  Clear
                </Button>
              )}
            </div>
            <FieldError id="sub-paid-error" message={errors.paidUntil} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sub-notes">
              Billing notes <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="sub-notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={NOTES_MAX}
              placeholder="e.g. Paid ৳4,000 by bKash on 3 Oct, ref 8XK2…"
              disabled={submitting}
              {...errorProps("sub-notes", errors.notes)}
            />
            <div className="flex justify-between">
              <FieldError id="sub-notes-error" message={errors.notes} />
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                {notes.length}/{NOTES_MAX}
              </span>
            </div>
          </div>
          <ServerError message={serverError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
              Save record
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
