"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { IdCard, Pencil, Phone, UserPlus, Users } from "lucide-react";

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
import { AVAILABILITY_LABELS, DRIVER_AVAILABILITY } from "@/lib/constants";
import { initials } from "@/lib/format";
import type { DriverItem } from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

// ── helpers ──────────────────────────────────────────────────

function clampMaxJobs(value: string): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 3;
  return Math.min(10, Math.max(1, n));
}

const DEACTIVATE_ACTION_CLASSES =
  "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/30 dark:bg-rose-600 dark:hover:bg-rose-700";

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
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_ADD_FORM);
      setSubmitting(false);
    }
  }, [open]);

  const field =
    (key: keyof AddDriverForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const email = form.email.trim();
    const phone = form.phone.trim();
    const licenseNumber = form.licenseNumber.trim();
    if (!name || !email || !phone || !licenseNumber) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (form.password.length < 8) {
      toast.error("Initial password must be at least 8 characters");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/api/drivers", {
        name,
        email,
        password: form.password,
        phone,
        licenseNumber,
        maxActiveJobs: clampMaxJobs(form.maxActiveJobs),
      });
      toast.success(`Driver account created for ${name}`);
      useAppStore.getState().bump();
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create driver");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add driver</DialogTitle>
          <DialogDescription>Create a driver account for your organization.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-driver-name">Full name</Label>
            <Input
              id="new-driver-name"
              value={form.name}
              onChange={field("name")}
              placeholder="e.g. Jordan Blake"
              maxLength={120}
              required
            />
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
              required
            />
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
              required
            />
            <p className="text-xs text-muted-foreground">
              Share this with the driver — they can&rsquo;t change it in this demo.
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
              />
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
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-driver-max-jobs">Max active jobs</Label>
            <Input
              id="new-driver-max-jobs"
              type="number"
              min={1}
              max={10}
              value={form.maxActiveJobs}
              onChange={field("maxActiveJobs")}
            />
          </div>
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

const EMPTY_EDIT_FORM: EditDriverForm = {
  name: "",
  phone: "",
  licenseNumber: "",
  availability: "AVAILABLE",
  maxActiveJobs: "3",
};

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
  const [form, setForm] = useState<EditDriverForm>(EMPTY_EDIT_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && driver) {
      setForm({
        name: driver.name,
        phone: driver.phone,
        licenseNumber: driver.licenseNumber,
        availability: driver.availability,
        maxActiveJobs: String(driver.maxActiveJobs),
      });
      setSubmitting(false);
    }
  }, [open, driver]);

  const field =
    (key: keyof EditDriverForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!driver) return;
    const name = form.name.trim();
    if (name.length < 2) {
      toast.error("Name must be at least 2 characters");
      return;
    }
    setSubmitting(true);
    try {
      await api.patch(`/api/drivers/${driver.id}`, {
        name,
        phone: form.phone.trim(),
        licenseNumber: form.licenseNumber.trim(),
        availability: form.availability,
        maxActiveJobs: clampMaxJobs(form.maxActiveJobs),
      });
      toast.success("Driver updated");
      useAppStore.getState().bump();
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update driver");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Edit driver</DialogTitle>
          <DialogDescription>Update {driver?.name}&rsquo;s contact details and capacity.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-driver-name">Full name</Label>
            <Input id="edit-driver-name" value={form.name} onChange={field("name")} maxLength={120} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-driver-phone">Phone</Label>
            <Input id="edit-driver-phone" type="tel" value={form.phone} onChange={field("phone")} maxLength={30} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-driver-license">License number</Label>
            <Input
              id="edit-driver-license"
              value={form.licenseNumber}
              onChange={field("licenseNumber")}
              className="font-mono"
              maxLength={40}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-driver-availability">Availability</Label>
              <Select
                value={form.availability}
                onValueChange={(v) => setForm((f) => ({ ...f, availability: v }))}
              >
                <SelectTrigger id="edit-driver-availability" className="w-full">
                  <SelectValue placeholder="Availability" />
                </SelectTrigger>
                <SelectContent>
                  {DRIVER_AVAILABILITY.map((a) => (
                    <SelectItem key={a} value={a}>
                      {AVAILABILITY_LABELS[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-driver-max-jobs">Max active jobs</Label>
              <Input
                id="edit-driver-max-jobs"
                type="number"
                min={1}
                max={10}
                value={form.maxActiveJobs}
                onChange={field("maxActiveJobs")}
              />
            </div>
          </div>
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
}: {
  driver: DriverItem;
  busy: boolean;
  onToggle: (driver: DriverItem, next: boolean) => void;
  onEdit: (driver: DriverItem) => void;
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

      <div className="flex justify-end border-t pt-3">
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
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<DriverItem | null>(null);
  const [confirmOff, setConfirmOff] = useState<DriverItem | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const drivers = data?.items ?? [];

  const toggleActive = async (driver: DriverItem, active: boolean) => {
    setTogglingId(driver.id);
    try {
      await api.patch(`/api/drivers/${driver.id}`, { active });
      toast.success(active ? `${driver.name} reactivated` : `${driver.name} deactivated`);
      useAppStore.getState().bump();
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update driver");
    } finally {
      setTogglingId(null);
    }
  };

  const openEdit = (driver: DriverItem) => {
    setEditing(driver);
    setEditOpen(true);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditing(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Drivers</h2>
          <p className="text-sm text-muted-foreground">
            Manage driver accounts, availability and workload.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="min-h-11 sm:min-h-10">
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
        <Card className="p-6">
          <p className="text-sm text-destructive">Failed to load drivers: {error}</p>
        </Card>
      ) : drivers.length === 0 ? (
        <Card className="p-10 text-center">
          <Users className="mx-auto size-10 text-muted-foreground/50" aria-hidden />
          <h3 className="mt-4 font-medium">No drivers yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your first driver to start assigning deliveries.
          </p>
          <Button onClick={() => setAddOpen(true)} className="mt-4 min-h-11">
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
            />
          ))}
        </div>
      )}

      <AddDriverDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => {
          setAddOpen(false);
          reload();
        }}
      />

      <EditDriverDialog
        driver={editing}
        open={editOpen}
        onOpenChange={(o) => (o ? setEditOpen(true) : closeEdit())}
        onSaved={() => {
          closeEdit();
          reload();
        }}
      />

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
