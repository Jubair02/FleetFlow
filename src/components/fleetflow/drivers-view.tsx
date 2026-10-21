"use client";

import { useState } from "react";
import { toast } from "sonner";
import { IdCard, KeyRound, Pencil, Phone, RefreshCw, UserPlus, Users } from "lucide-react";

import { AvailabilityBadge } from "@/components/fleetflow/badges";
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
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, useApiData } from "@/lib/api-client";
import { AVAILABILITY_LABELS } from "@/lib/constants";
import { initials } from "@/lib/format";
import type { DriverItem } from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { TemporaryPasswordDialog } from "@/components/fleetflow/change-password-dialog";
import type { TempPasswordResult } from "@/lib/types-org";

// ── helpers ──────────────────────────────────────────────────

const DEACTIVATE_ACTION_CLASSES =
  "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/30 dark:bg-rose-600 dark:hover:bg-rose-700";

/** Availability an admin can set — ON_ROUTE is derived from active jobs on the server. */
const SETTABLE_AVAILABILITY = ["AVAILABLE", "OFF_DUTY"] as const;

type FieldErrors = Partial<Record<"name" | "email" | "password" | "phone" | "licenseNumber" | "maxActiveJobs", string>>;

/** Client-side mirror of the server's driver schema (create + update). */
function validateDriverFields(f: {
  name?: string;
  email?: string;
  password?: string;
  phone?: string;
  licenseNumber?: string;
  maxActiveJobs?: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (f.name !== undefined) {
    const n = f.name.trim().length;
    if (n < 2) errors.name = "Name must be at least 2 characters";
    else if (n > 120) errors.name = "Name must be 120 characters or fewer";
  }
  if (f.email !== undefined) {
    const email = f.email.trim();
    if (!email) errors.email = "Email is required";
    else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email";
  }
  if (f.password !== undefined) {
    if (f.password.length < 8) errors.password = "Password must be at least 8 characters";
    else if (f.password.length > 200) errors.password = "Password must be 200 characters or fewer";
  }
  if (f.phone !== undefined) {
    const n = f.phone.trim().length;
    if (n < 6) errors.phone = "Phone must be at least 6 characters";
    else if (n > 30) errors.phone = "Phone must be 30 characters or fewer";
  }
  if (f.licenseNumber !== undefined) {
    const n = f.licenseNumber.trim().length;
    if (n < 3) errors.licenseNumber = "License number must be at least 3 characters";
    else if (n > 40) errors.licenseNumber = "License number must be 40 characters or fewer";
  }
  if (f.maxActiveJobs !== undefined) {
    const n = Number(f.maxActiveJobs);
    if (f.maxActiveJobs.trim() === "" || !Number.isInteger(n) || n < 1 || n > 10) {
      errors.maxActiveJobs = "Enter a whole number from 1 to 10";
    }
  }
  return errors;
}

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

/** aria props linking an input to its inline error. */
function errorProps(id: string, message?: string) {
  return message ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};
}

// ── add driver dialog ────────────────────────────────────────

interface AddDriverForm {
  name: string;
  email: string;
  password: string;
  phone: string;
  licenseNumber: string;
  maxActiveJobs: string;
}

const EMPTY_ADD_FORM: AddDriverForm = {
  name: "",
  email: "",
  password: "",
  phone: "",
  licenseNumber: "",
  maxActiveJobs: "3",
};

/** Remounted (via `key`) each time it opens, so the form always starts empty. */
function AddDriverDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<AddDriverForm>(EMPTY_ADD_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const field =
    (key: keyof AddDriverForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setForm((f) => ({ ...f, [key]: value }));
      setErrors((errs) => (errs[key] ? { ...errs, [key]: undefined } : errs));
    };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateDriverFields(form);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length > 0) return;
    const name = form.name.trim();
    setSubmitting(true);
    try {
      await api.post("/api/drivers", {
        name,
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim(),
        licenseNumber: form.licenseNumber.trim(),
        maxActiveJobs: Number(form.maxActiveJobs),
      });
      toast.success(`Driver account created for ${name}`);
      useAppStore.getState().bump();
      onCreated();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Failed to create driver");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add driver</DialogTitle>
          <DialogDescription>Create a driver account for your organization.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="new-driver-name">Full name</Label>
            <Input
              id="new-driver-name"
              value={form.name}
              onChange={field("name")}
              placeholder="e.g. Jordan Blake"
              maxLength={120}
              required
              {...errorProps("new-driver-name", errors.name)}
            />
            <FieldError id="new-driver-name-error" message={errors.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-driver-email">Email</Label>
            <Input
              id="new-driver-email"
              type="email"
              value={form.email}
              onChange={field("email")}
              placeholder="driver@fleetflow.test"
              autoComplete="off"
              maxLength={254}
              required
              {...errorProps("new-driver-email", errors.email)}
            />
            <FieldError id="new-driver-email-error" message={errors.email} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-driver-password">Initial password</Label>
            <Input
              id="new-driver-password"
              type="text"
              className="font-mono"
              value={form.password}
              onChange={field("password")}
              placeholder="At least 8 characters"
              autoComplete="off"
              maxLength={200}
              required
              {...errorProps("new-driver-password", errors.password)}
            />
            <FieldError id="new-driver-password-error" message={errors.password} />
            <p className="text-xs text-muted-foreground">
              Share this privately with the driver. They can change it from the account menu after signing in.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-driver-phone">Phone</Label>
              <Input
                id="new-driver-phone"
                type="tel"
                value={form.phone}
                onChange={field("phone")}
                placeholder="+1 555 010 1234"
                maxLength={30}
                required
                {...errorProps("new-driver-phone", errors.phone)}
              />
              <FieldError id="new-driver-phone-error" message={errors.phone} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-driver-license">License number</Label>
              <Input
                id="new-driver-license"
                value={form.licenseNumber}
                onChange={field("licenseNumber")}
                placeholder="DL-884521"
                maxLength={40}
                required
                {...errorProps("new-driver-license", errors.licenseNumber)}
              />
              <FieldError id="new-driver-license-error" message={errors.licenseNumber} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-driver-max-jobs">Max active jobs</Label>
            <Input
              id="new-driver-max-jobs"
              type="number"
              inputMode="numeric"
              min={1}
              max={10}
              step={1}
              value={form.maxActiveJobs}
              onChange={field("maxActiveJobs")}
              {...errorProps("new-driver-max-jobs", errors.maxActiveJobs)}
            />
            <FieldError id="new-driver-max-jobs-error" message={errors.maxActiveJobs} />
          </div>
          <ServerError message={serverError} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="min-h-11 sm:min-h-9"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="min-h-11 sm:min-h-9">
              {submitting ? "Creating…" : "Create driver"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── edit driver dialog ───────────────────────────────────────

interface EditDriverForm {
  name: string;
  phone: string;
  licenseNumber: string;
  availability: string;
  maxActiveJobs: string;
}

/** Remounted (via `key`) for every driver it opens with, so the form starts from that driver. */
function EditDriverDialog({
  driver,
  open,
  onOpenChange,
  onSaved,
}: {
  driver: DriverItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<EditDriverForm>(() => ({
    name: driver?.name ?? "",
    phone: driver?.phone ?? "",
    licenseNumber: driver?.licenseNumber ?? "",
    availability: driver?.availability ?? "AVAILABLE",
    maxActiveJobs: String(driver?.maxActiveJobs ?? 3),
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ON_ROUTE is set automatically while the driver has jobs — shown read-only.
  const onRoute = driver?.availability === "ON_ROUTE";
  const hasActiveJobs = (driver?.activeJobs ?? 0) > 0;

  const field =
    (key: keyof EditDriverForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setForm((f) => ({ ...f, [key]: value }));
      setErrors((errs) => (key in errs ? { ...errs, [key]: undefined } : errs));
    };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!driver) return;
    // Only send (and validate) what changed — untouched legacy values never block a save.
    const changed: Partial<EditDriverForm> = {};
    if (form.name.trim() !== driver.name) changed.name = form.name;
    if (form.phone.trim() !== driver.phone) changed.phone = form.phone;
    if (form.licenseNumber.trim() !== driver.licenseNumber) changed.licenseNumber = form.licenseNumber;
    if (form.maxActiveJobs.trim() !== String(driver.maxActiveJobs)) changed.maxActiveJobs = form.maxActiveJobs;
    const found = validateDriverFields(changed);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length > 0) return;

    const body: Record<string, string | number> = {};
    if (changed.name !== undefined) body.name = changed.name.trim();
    if (changed.phone !== undefined) body.phone = changed.phone.trim();
    if (changed.licenseNumber !== undefined) body.licenseNumber = changed.licenseNumber.trim();
    if (changed.maxActiveJobs !== undefined) body.maxActiveJobs = Number(changed.maxActiveJobs);
    if (!onRoute && form.availability !== driver.availability) body.availability = form.availability;
    if (Object.keys(body).length === 0) {
      onOpenChange(false);
      return;
    }

    setSubmitting(true);
    try {
      await api.patch(`/api/drivers/${driver.id}`, body);
      toast.success("Driver updated");
      useAppStore.getState().bump();
      onSaved();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Failed to update driver");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Edit driver</DialogTitle>
          <DialogDescription>Update {driver?.name}&rsquo;s contact details and capacity.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="edit-driver-name">Full name</Label>
            <Input
              id="edit-driver-name"
              value={form.name}
              onChange={field("name")}
              maxLength={120}
              required
              {...errorProps("edit-driver-name", errors.name)}
            />
            <FieldError id="edit-driver-name-error" message={errors.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-driver-phone">Phone</Label>
            <Input
              id="edit-driver-phone"
              type="tel"
              value={form.phone}
              onChange={field("phone")}
              maxLength={30}
              {...errorProps("edit-driver-phone", errors.phone)}
            />
            <FieldError id="edit-driver-phone-error" message={errors.phone} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-driver-license">License number</Label>
            <Input
              id="edit-driver-license"
              value={form.licenseNumber}
              onChange={field("licenseNumber")}
              className="font-mono"
              maxLength={40}
              {...errorProps("edit-driver-license", errors.licenseNumber)}
            />
            <FieldError id="edit-driver-license-error" message={errors.licenseNumber} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              {onRoute ? (
                <>
                  <span className="text-sm leading-none font-medium">Availability</span>
                  <div className="flex min-h-9 items-center">
                    <AvailabilityBadge availability="ON_ROUTE" />
                  </div>
                  <p className="text-xs text-muted-foreground">Set automatically while the driver has active jobs.</p>
                </>
              ) : (
                <>
                  <Label htmlFor="edit-driver-availability">Availability</Label>
                  <Select
                    value={form.availability}
                    onValueChange={(v) => setForm((f) => ({ ...f, availability: v }))}
                  >
                    <SelectTrigger id="edit-driver-availability" className="w-full">
                      <SelectValue placeholder="Availability" />
                    </SelectTrigger>
                    <SelectContent>
                      {SETTABLE_AVAILABILITY.map((a) => (
                        <SelectItem
                          key={a}
                          value={a}
                          disabled={a === "OFF_DUTY" && hasActiveJobs && driver?.availability !== "OFF_DUTY"}
                        >
                          {AVAILABILITY_LABELS[a]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {hasActiveJobs && driver?.availability !== "OFF_DUTY" ? (
                    <p className="text-xs text-muted-foreground">Can&rsquo;t go off duty while jobs are active.</p>
                  ) : null}
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-driver-max-jobs">Max active jobs</Label>
              <Input
                id="edit-driver-max-jobs"
                type="number"
                inputMode="numeric"
                min={1}
                max={10}
                step={1}
                value={form.maxActiveJobs}
                onChange={field("maxActiveJobs")}
                {...errorProps("edit-driver-max-jobs", errors.maxActiveJobs)}
              />
              <FieldError id="edit-driver-max-jobs-error" message={errors.maxActiveJobs} />
            </div>
          </div>
          <ServerError message={serverError} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="min-h-11 sm:min-h-9"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="min-h-11 sm:min-h-9">
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── driver card ──────────────────────────────────────────────

function DriverCard({
  driver,
  busy,
  onToggle,
  onEdit,
  onResetPassword,
}: {
  driver: DriverItem;
  busy: boolean;
  onToggle: (driver: DriverItem, next: boolean) => void;
  onEdit: (driver: DriverItem) => void;
  onResetPassword: (driver: DriverItem) => void;
}) {
  const pct =
    driver.maxActiveJobs > 0
      ? Math.min(100, Math.round((driver.activeJobs / driver.maxActiveJobs) * 100))
      : 0;
  const atCapacity = driver.activeJobs >= driver.maxActiveJobs;

  return (
    <Card className={cn("gap-4 p-5 transition-opacity", !driver.active && "opacity-60")}>
      <CardContent className="flex items-start gap-3 space-y-0 p-0">
        <Avatar className="size-10 shrink-0">
          <AvatarFallback className="bg-primary/10 font-medium text-primary">
            {initials(driver.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="leading-tight font-medium">{driver.name}</span>
            {!driver.active && (
              <Badge
                variant="outline"
                className="border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300"
              >
                Deactivated
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">{driver.email}</p>
        </div>
        <Switch
          checked={driver.active}
          disabled={busy}
          onCheckedChange={(checked) => onToggle(driver, checked)}
          aria-label={driver.active ? `Deactivate ${driver.name}` : `Activate ${driver.name}`}
        />
      </CardContent>

      <div className="space-y-1.5 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Phone className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{driver.phone || "—"}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <IdCard className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate font-mono text-xs">{driver.licenseNumber || "—"}</span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AvailabilityBadge availability={driver.availability} />
          <span className="text-xs text-muted-foreground">
            {driver.activeJobs}/{driver.maxActiveJobs} active jobs
          </span>
        </div>
        <Progress
          value={pct}
          aria-label={`Workload: ${driver.activeJobs} of ${driver.maxActiveJobs} active jobs`}
          className={cn("h-2", atCapacity && "[&_[data-slot=progress-indicator]]:bg-amber-500")}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-emerald-600 dark:text-emerald-400">
          {driver.completedTotal} completed
        </span>
        <span aria-hidden> · </span>
        <span className="font-medium text-rose-600 dark:text-rose-400">{driver.failedTotal} failed</span>
      </p>

      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onResetPassword(driver)}
          disabled={busy}
          className="min-h-11 sm:min-h-8"
        >
          <KeyRound aria-hidden /> Reset password
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit(driver)}
          className="min-h-11 sm:min-h-8"
        >
          <Pencil aria-hidden /> Edit
        </Button>
      </div>
    </Card>
  );
}

// ── main view ────────────────────────────────────────────────

export function DriversView() {
  const { data, loading, error, reload } = useApiData<{ items: DriverItem[] }>("/api/drivers");
  const [addOpen, setAddOpen] = useState(false);
  /** Bumped on every open so the dialogs remount with fresh form state. */
  const [dialogSeq, setDialogSeq] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<DriverItem | null>(null);
  const [confirmOff, setConfirmOff] = useState<DriverItem | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState<DriverItem | null>(null);
  const [resetting, setResetting] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ name: string; email: string; password: string } | null>(null);

  const drivers = data?.items ?? [];

  const toggleActive = async (driver: DriverItem, active: boolean) => {
    setTogglingId(driver.id);
    try {
      await api.patch(`/api/drivers/${driver.id}`, { active });
      toast.success(active ? `${driver.name} reactivated` : `${driver.name} deactivated`);
      useAppStore.getState().bump(); // also refetches this list
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update driver");
    } finally {
      setTogglingId(null);
    }
  };

  const resetPassword = async (driver: DriverItem) => {
    setResetting(true);
    try {
      const res = await api.post<TempPasswordResult>(`/api/drivers/${driver.id}/password`, {});
      setConfirmReset(null);
      setTempPassword({ name: driver.name, email: driver.email, password: res.temporaryPassword });
      toast.success(`${driver.name}'s password was reset and they were signed out`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset the password");
    } finally {
      setResetting(false);
    }
  };

  const openAdd = () => {
    setDialogSeq((n) => n + 1);
    setAddOpen(true);
  };

  const openEdit = (driver: DriverItem) => {
    setDialogSeq((n) => n + 1);
    setEditing(driver);
    setEditOpen(true);
  };

  // Keep `editing` during the close animation; the next open remounts with new data.
  const closeEdit = () => setEditOpen(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Drivers</h2>
          <p className="text-sm text-muted-foreground">
            Manage driver accounts, availability and workload.
          </p>
        </div>
        <Button onClick={openAdd} className="min-h-11 sm:min-h-10">
          <UserPlus aria-hidden /> Add driver
        </Button>
      </div>

      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="gap-4 p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
                <Skeleton className="h-6 w-11 rounded-full" />
              </div>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-8 w-24 self-end" />
            </Card>
          ))}
        </div>
      ) : error && !data ? (
        <Card className="flex flex-col items-start gap-3 p-6">
          <p className="text-sm text-destructive">Failed to load drivers: {error}</p>
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCw aria-hidden /> Try again
          </Button>
        </Card>
      ) : drivers.length === 0 ? (
        <Card className="p-10 text-center">
          <Users className="mx-auto size-10 text-muted-foreground/50" aria-hidden />
          <h3 className="mt-4 font-medium">No drivers yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your first driver to start assigning deliveries.
          </p>
          <Button onClick={openAdd} className="mt-4 min-h-11">
            <UserPlus aria-hidden /> Add driver
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {drivers.map((driver) => (
            <DriverCard
              key={driver.id}
              driver={driver}
              busy={togglingId === driver.id}
              onToggle={(d, next) => (next ? void toggleActive(d, true) : setConfirmOff(d))}
              onEdit={openEdit}
              onResetPassword={setConfirmReset}
            />
          ))}
        </div>
      )}

      <AddDriverDialog
        key={`add-${dialogSeq}`}
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => setAddOpen(false)}
      />

      <EditDriverDialog
        key={`edit-${editing?.id ?? "none"}-${dialogSeq}`}
        driver={editing}
        open={editOpen}
        onOpenChange={(o) => (o ? setEditOpen(true) : closeEdit())}
        onSaved={closeEdit}
      />

      <AlertDialog open={confirmReset !== null} onOpenChange={(o) => !o && !resetting && setConfirmReset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset {confirmReset?.name}&rsquo;s password?</AlertDialogTitle>
            <AlertDialogDescription>
              A new temporary password will be generated and shown once. {confirmReset?.name} will be signed out on every
              device and must choose their own password at their next sign-in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 sm:min-h-9" disabled={resetting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={resetting}
              onClick={(e) => {
                e.preventDefault(); // keep the dialog open until the request finishes
                if (confirmReset) void resetPassword(confirmReset);
              }}
            >
              {resetting ? "Resetting…" : "Reset password"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TemporaryPasswordDialog result={tempPassword} onClose={() => setTempPassword(null)} />

      <AlertDialog open={confirmOff !== null} onOpenChange={(o) => !o && setConfirmOff(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {confirmOff?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will be signed out immediately and can&rsquo;t receive new jobs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 sm:min-h-9">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={DEACTIVATE_ACTION_CLASSES}
              onClick={() => {
                if (confirmOff) void toggleActive(confirmOff, false);
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default DriversView;
