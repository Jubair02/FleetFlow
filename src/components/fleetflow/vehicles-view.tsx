"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bike,
  Car,
  CircleOff,
  Container,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Snowflake,
  Trash2,
  Truck,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { VehicleStatusBadge, VehicleTypeLabel } from "@/components/fleetflow/badges";
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
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, useApiData } from "@/lib/api-client";
import { VEHICLE_TYPES } from "@/lib/constants";
import type { VehicleItem } from "@/lib/types";
import { useAppStore } from "@/store/app-store";

// ── helpers ──────────────────────────────────────────────────

const TYPE_ICONS: Record<string, LucideIcon> = {
  VAN: Truck,
  BOX_TRUCK: Container,
  MOTORCYCLE: Bike,
  CAR: Car,
  REFRIGERATED: Snowflake,
};

const STATUS_TOAST: Record<string, string> = {
  MAINTENANCE: "sent to maintenance",
  ACTIVE: "returned to service",
  INACTIVE: "deactivated",
};

const DESTRUCTIVE_ACTION_CLASSES =
  "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/30 dark:bg-rose-600 dark:hover:bg-rose-700";

function VehicleTypeCell({ type }: { type: string }) {
  const Icon = TYPE_ICONS[type] ?? Truck;
  return (
    <span className="flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <VehicleTypeLabel type={type} />
    </span>
  );
}

// ── register / edit dialog ───────────────────────────────────

interface VehicleFormState {
  registrationNumber: string;
  type: string;
  capacity: string;
  notes: string;
}

const EMPTY_VEHICLE_FORM: VehicleFormState = {
  registrationNumber: "",
  type: "VAN",
  capacity: "",
  notes: "",
};

function VehicleFormDialog({
  open,
  vehicle,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  vehicle: VehicleItem | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<VehicleFormState>(EMPTY_VEHICLE_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(
        vehicle
          ? {
              registrationNumber: vehicle.registrationNumber,
              type: vehicle.type,
              capacity: vehicle.capacity ?? "",
              notes: vehicle.notes ?? "",
            }
          : EMPTY_VEHICLE_FORM,
      );
      setSubmitting(false);
    }
  }, [open, vehicle]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const registrationNumber = form.registrationNumber.trim().toUpperCase();
    if (registrationNumber.length < 3) {
      toast.error("Registration number must be at least 3 characters");
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        registrationNumber,
        type: form.type,
        capacity: form.capacity.trim(),
        notes: form.notes.trim(),
      };
      if (vehicle) {
        await api.patch(`/api/vehicles/${vehicle.id}`, body);
        toast.success(`Vehicle ${registrationNumber} updated`);
      } else {
        await api.post("/api/vehicles", body);
        toast.success(`Vehicle ${registrationNumber} registered`);
      }
      useAppStore.getState().bump();
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save vehicle");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{vehicle ? "Edit vehicle" : "Register vehicle"}</DialogTitle>
          <DialogDescription>
            {vehicle
              ? `Update details for ${vehicle.registrationNumber}.`
              : "Add a new vehicle to your fleet."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-registration">Registration number</Label>
              <Input
                id="vehicle-registration"
                value={form.registrationNumber}
                onChange={(e) => setForm((f) => ({ ...f, registrationNumber: e.target.value }))}
                placeholder="e.g. ABC-1234"
                className="font-mono"
                maxLength={20}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-type">Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger id="vehicle-type" className="w-full">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  {VEHICLE_TYPES.map((t) => {
                    const Icon = TYPE_ICONS[t] ?? Truck;
                    return (
                      <SelectItem key={t} value={t}>
                        <span className="flex items-center gap-2">
                          <Icon className="size-4 text-muted-foreground" aria-hidden />
                          <VehicleTypeLabel type={t} />
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vehicle-capacity">Capacity</Label>
            <Input
              id="vehicle-capacity"
              value={form.capacity}
              onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
              placeholder="e.g. 1.2 t / 8 m³"
              maxLength={40}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vehicle-notes">Notes</Label>
            <Textarea
              id="vehicle-notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional notes — e.g. service schedule, restrictions"
              rows={3}
              maxLength={300}
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
              {submitting ? "Saving…" : vehicle ? "Save changes" : "Register vehicle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── row actions menu ─────────────────────────────────────────

type VehicleStatusAction = "MAINTENANCE" | "ACTIVE" | "INACTIVE";

function VehicleActions({
  vehicle,
  busy,
  onEdit,
  onStatus,
  onDelete,
}: {
  vehicle: VehicleItem;
  busy: boolean;
  onEdit: (vehicle: VehicleItem) => void;
  onStatus: (vehicle: VehicleItem, status: VehicleStatusAction) => void;
  onDelete: (vehicle: VehicleItem) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 sm:size-9"
          disabled={busy}
          aria-label={`Actions for ${vehicle.registrationNumber}`}
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => onEdit(vehicle)}>
          <Pencil aria-hidden /> Edit details
        </DropdownMenuItem>
        {vehicle.status === "ACTIVE" && (
          <DropdownMenuItem onClick={() => onStatus(vehicle, "MAINTENANCE")}>
            <Wrench aria-hidden /> Send to maintenance
          </DropdownMenuItem>
        )}
        {vehicle.status === "MAINTENANCE" && (
          <DropdownMenuItem onClick={() => onStatus(vehicle, "ACTIVE")}>
            <RotateCcw aria-hidden /> Return to service
          </DropdownMenuItem>
        )}
        {vehicle.status === "ACTIVE" && (
          <DropdownMenuItem onClick={() => onStatus(vehicle, "INACTIVE")}>
            <CircleOff aria-hidden /> Deactivate
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {vehicle.activeJobs === 0 ? (
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(vehicle)}>
            <Trash2 aria-hidden /> Delete
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled className="flex-col items-start gap-0.5">
            <span className="flex items-center gap-2">
              <Trash2 aria-hidden /> Delete
            </span>
            <span className="pl-6 text-xs font-normal text-muted-foreground">
              Blocked — {vehicle.activeJobs} active job{vehicle.activeJobs === 1 ? "" : "s"}
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── main view ────────────────────────────────────────────────

export function VehiclesView() {
  const { data, loading, error, reload } = useApiData<{ items: VehicleItem[] }>("/api/vehicles");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleItem | null>(null);
  const [deleting, setDeleting] = useState<VehicleItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const vehicles = data?.items ?? [];

  const counts = useMemo(() => {
    const c = { ACTIVE: 0, MAINTENANCE: 0, INACTIVE: 0 };
    for (const v of vehicles) {
      if (v.status in c) c[v.status as keyof typeof c] += 1;
    }
    return c;
  }, [vehicles]);

  const openRegister = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (vehicle: VehicleItem) => {
    setEditing(vehicle);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const changeStatus = async (vehicle: VehicleItem, status: VehicleStatusAction) => {
    setBusyId(vehicle.id);
    try {
      await api.patch(`/api/vehicles/${vehicle.id}`, { status });
      toast.success(`${vehicle.registrationNumber} ${STATUS_TOAST[status] ?? "updated"}`);
      useAppStore.getState().bump();
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update vehicle");
    } finally {
      setBusyId(null);
    }
  };

  const deleteVehicle = async (vehicle: VehicleItem) => {
    setBusyId(vehicle.id);
    try {
      await api.del(`/api/vehicles/${vehicle.id}`);
      toast.success(`${vehicle.registrationNumber} deleted`);
      useAppStore.getState().bump();
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete vehicle");
    } finally {
      setBusyId(null);
    }
  };

  const actionsProps = {
    onEdit: openEdit,
    onStatus: (v: VehicleItem, s: VehicleStatusAction) => void changeStatus(v, s),
    onDelete: (v: VehicleItem) => setDeleting(v),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Vehicles</h2>
          <p className="text-sm text-muted-foreground">Manage your fleet and maintenance status.</p>
        </div>
        <Button onClick={openRegister} className="min-h-11 sm:min-h-10">
          <Plus aria-hidden /> Register vehicle
        </Button>
      </div>

      {loading && !data ? (
        <Card className="p-6" aria-busy="true">
          <div className="mb-4 flex gap-2">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-20" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      ) : error && !data ? (
        <Card className="p-6">
          <p className="text-sm text-destructive">Failed to load vehicles: {error}</p>
        </Card>
      ) : vehicles.length === 0 ? (
        <Card className="p-10 text-center">
          <Truck className="mx-auto size-10 text-muted-foreground/50" aria-hidden />
          <h3 className="mt-4 font-medium">No vehicles yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Register your first vehicle to start dispatching deliveries.
          </p>
          <Button onClick={openRegister} className="mt-4 min-h-11">
            <Plus aria-hidden /> Register vehicle
          </Button>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
            >
              {counts.ACTIVE} active
            </Badge>
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
            >
              {counts.MAINTENANCE} maintenance
            </Badge>
            <Badge
              variant="outline"
              className="border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400"
            >
              {counts.INACTIVE} inactive
            </Badge>
          </div>

          {/* Desktop table */}
          <Card className="hidden overflow-hidden md:block">
            <CardContent className="overflow-x-auto p-0">
              <Table className="min-w-[820px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Registration</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Active jobs</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="w-14">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vehicles.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono font-medium whitespace-nowrap">
                        {v.registrationNumber}
                      </TableCell>
                      <TableCell>
                        <VehicleTypeCell type={v.type} />
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                        {v.capacity || "—"}
                      </TableCell>
                      <TableCell>
                        <VehicleStatusBadge status={v.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          {v.activeJobs}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[240px]">
                        <div className="space-y-0.5">
                          <p className="truncate text-sm text-muted-foreground">{v.notes || "—"}</p>
                          {v.status === "MAINTENANCE" && v.notes && (
                            <p className="whitespace-normal text-xs text-amber-700 dark:text-amber-400">
                              {v.notes}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <VehicleActions vehicle={v} busy={busyId === v.id} {...actionsProps} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Mobile cards */}
          <div className="grid gap-4 md:hidden">
            {vehicles.map((v) => {
              const Icon = TYPE_ICONS[v.type] ?? Truck;
              return (
                <Card key={v.id} className="gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono font-medium">{v.registrationNumber}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Icon className="size-3.5 shrink-0" aria-hidden />
                        <VehicleTypeLabel type={v.type} />
                        {v.capacity ? <span aria-hidden> · {v.capacity}</span> : null}
                      </p>
                    </div>
                    <VehicleStatusBadge status={v.status} />
                  </div>
                  {v.notes && (
                    <p className="whitespace-normal text-sm text-muted-foreground">{v.notes}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 border-t pt-3">
                    <p className="text-xs text-muted-foreground">
                      Active jobs:{" "}
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">
                        {v.activeJobs}
                      </span>
                    </p>
                    <VehicleActions vehicle={v} busy={busyId === v.id} {...actionsProps} />
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <VehicleFormDialog
        open={formOpen}
        vehicle={editing}
        onOpenChange={(o) => (o ? setFormOpen(true) : closeForm())}
        onSaved={() => {
          closeForm();
          reload();
        }}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.registrationNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Vehicles with assignment history can&rsquo;t be deleted — set
              them inactive instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 sm:min-h-9">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={DESTRUCTIVE_ACTION_CLASSES}
              onClick={() => {
                if (deleting) void deleteVehicle(deleting);
              }}
            >
              Delete vehicle
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default VehiclesView;
