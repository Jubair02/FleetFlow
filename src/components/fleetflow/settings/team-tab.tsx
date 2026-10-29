"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Clock, KeyRound, Mail, ShieldCheck, UserCheck, UserMinus, UserPlus, Users } from "lucide-react";

import { TemporaryPasswordDialog } from "@/components/fleetflow/change-password-dialog";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import { initials, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createStaffSchema } from "@/lib/validation";
import type { StaffItem, StaffList, TempPasswordResult } from "@/lib/types-org";
import { goToSettings, useAppStore } from "@/store/app-store";
import { FieldError, IconChip, LoadError, PANEL, ServerError, WithIcon, errorProps, issuesByField } from "./shared";

const DEACTIVATE_ACTION_CLASSES =
  "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/30 dark:bg-rose-600 dark:hover:bg-rose-700";

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
          <div className="mb-1 flex items-center gap-3">
            <IconChip icon={UserPlus} />
            <DialogTitle>Add a dispatcher</DialogTitle>
          </div>
          <DialogDescription>
            They get full admin access to dispatch, drivers and settings. We&apos;ll generate a temporary password for you to share.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="staff-name">Full name</Label>
            <WithIcon icon={UserCheck}>
              <Input
                id="staff-name"
                value={form.name}
                onChange={field("name")}
                maxLength={120}
                placeholder="e.g. Nusrat Jahan"
                className="pl-9"
                {...errorProps("staff-name", errors.name)}
              />
            </WithIcon>
            <FieldError id="staff-name-error" message={errors.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-email">Email</Label>
            <WithIcon icon={Mail}>
              <Input
                id="staff-email"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={field("email")}
                maxLength={254}
                placeholder="name@company.com"
                className="pl-9"
                {...errorProps("staff-email", errors.email)}
              />
            </WithIcon>
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

// ── seats ────────────────────────────────────────────────────

function SeatMeter({ data }: { data: StaffList }) {
  const { activeCount, limit } = data;
  const pct = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, (activeCount / limit) * 100);
  const full = limit !== null && activeCount >= limit;
  const near = !full && limit !== null && pct >= 80;
  return (
    <div className="min-w-0 flex-1 sm:max-w-xs">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium text-muted-foreground">Admin seats</span>
        <span className={cn("tabular-nums", full ? "font-semibold text-amber-600 dark:text-amber-400" : "text-foreground")}>
          {limit === null ? (
            <>
              <span className="font-semibold">{activeCount}</span> active · unlimited
            </>
          ) : (
            <>
              <span className="font-semibold">{activeCount}</span> of {limit} used
            </>
          )}
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label="Admin seats used"
        aria-valuemin={0}
        aria-valuemax={limit ?? activeCount}
        aria-valuenow={activeCount}
        aria-valuetext={limit === null ? `${activeCount} active, unlimited` : `${activeCount} of ${limit} used`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            limit === null ? "w-full bg-gradient-to-r from-emerald-500/40 to-teal-500/40" : full ? "bg-amber-500" : near ? "bg-amber-400" : "bg-gradient-to-r from-emerald-500 to-teal-500",
          )}
          style={limit === null ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── members ──────────────────────────────────────────────────

function MemberRow({
  m,
  busy,
  onReset,
  onDeactivate,
  onActivate,
}: {
  m: StaffItem;
  busy: boolean;
  onReset: () => void;
  onDeactivate: () => void;
  onActivate: () => void;
}) {
  return (
    <li className={cn("group/row flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:px-6", !m.active && "bg-muted/20")}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="relative shrink-0">
          <Avatar className={cn("size-10 ring-2 ring-offset-2 ring-offset-card", m.active ? "ring-emerald-500/25" : "ring-transparent grayscale")}>
            <AvatarFallback
              className={cn(
                "text-xs font-semibold",
                m.active
                  ? "bg-gradient-to-br from-emerald-500/15 to-teal-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {initials(m.name)}
            </AvatarFallback>
          </Avatar>
          {m.active && (
            <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-card bg-emerald-500" aria-hidden="true" />
          )}
        </div>
        <div className={cn("min-w-0", !m.active && "opacity-70")}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{m.name}</span>
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
          <p className="truncate text-xs text-muted-foreground">{m.email}</p>
        </div>
      </div>

      <p className="flex shrink-0 items-center gap-1.5 pl-[3.25rem] text-xs text-muted-foreground sm:w-40 sm:pl-0">
        <Clock className="size-3.5" aria-hidden="true" />
        {m.lastLoginAt ? `Active ${timeAgo(m.lastLoginAt)}` : "Never signed in"}
      </p>

      <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:w-[17rem] sm:justify-end">
        {m.isYou ? (
          <span className="col-span-2 inline-flex items-center gap-1.5 pl-[3.25rem] text-xs text-muted-foreground sm:pl-0">
            <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> Signed in now
          </span>
        ) : m.active ? (
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onReset} className="min-h-11 sm:min-h-8">
              <KeyRound aria-hidden /> Reset password
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onDeactivate}
              className="min-h-11 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 sm:min-h-8 dark:hover:border-rose-900 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
            >
              <UserMinus aria-hidden /> Deactivate
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" disabled={busy} onClick={onActivate} className="min-h-11 sm:min-h-8">
            <UserCheck aria-hidden /> {busy ? "Reactivating…" : "Reactivate"}
          </Button>
        )}
      </div>
    </li>
  );
}

type PendingAction = { member: StaffItem; action: "deactivate" | "reset-password" };

export function TeamTab({
  data,
  loading,
  error,
  reload,
}: {
  data: StaffList | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [addSeq, setAddSeq] = useState(0);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<{ name: string; email: string; password: string } | null>(null);

  const items = data?.items ?? [];
  const atLimit = data ? data.limit !== null && data.activeCount >= data.limit : false;
  const inactive = items.filter((m) => !m.active).length;

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
      <section className={PANEL} aria-labelledby="team-title">
        <header className="flex flex-col gap-4 border-b px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <IconChip icon={Users} />
            <div className="min-w-0">
              <h3 id="team-title" className="text-base font-semibold">
                Dispatchers &amp; admins
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                People who can dispatch, manage drivers and change settings
                {inactive > 0 ? ` · ${inactive} deactivated` : ""}.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            {data && <SeatMeter data={data} />}
            <Button
              onClick={() => {
                setAddSeq((n) => n + 1);
                setAddOpen(true);
              }}
              disabled={!data || atLimit}
              title={atLimit ? "Your plan's dispatcher limit is reached — upgrade to add more" : undefined}
              className="min-h-11 shrink-0 sm:min-h-9"
            >
              <UserPlus aria-hidden /> Add dispatcher
            </Button>
          </div>
        </header>

        {atLimit && (
          <div className="flex flex-col gap-2 border-b bg-amber-50/70 px-5 py-3 text-xs text-amber-800 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:bg-amber-950/30 dark:text-amber-300">
            <p>You&apos;ve reached your plan&apos;s dispatcher limit. Deactivate someone or upgrade your plan to add more.</p>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto self-start p-0 text-xs font-semibold text-amber-800 sm:self-auto dark:text-amber-300"
              onClick={() => goToSettings("plan")}
            >
              See plans →
            </Button>
          </div>
        )}

        {loading && !data ? (
          <ul className="divide-y" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-4 sm:px-6">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </li>
            ))}
          </ul>
        ) : error && !data ? (
          <div className="p-5 sm:p-6">
            <LoadError what="your team" error={error} onRetry={reload} />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-muted">
              <Users className="size-6 text-muted-foreground" aria-hidden />
            </span>
            <p className="text-sm font-medium">No team members yet</p>
            <p className="text-xs text-muted-foreground">Add a dispatcher to share the workload.</p>
          </div>
        ) : (
          <ul className="divide-y" aria-label="Team members">
            {items.map((m) => (
              <MemberRow
                key={m.id}
                m={m}
                busy={busyId === m.id}
                onReset={() => setPending({ member: m, action: "reset-password" })}
                onDeactivate={() => setPending({ member: m, action: "deactivate" })}
                onActivate={() => void run(m, "activate")}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        Drivers sign in with their own accounts and are managed from the Drivers page. Every change here is recorded in the audit log.
      </p>

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
