"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Truck,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";

import { api, useApiData } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import type { AssignmentHistoryItem, Delivery, DispatchData } from "@/lib/types";
import { failureReasonLabel } from "@/lib/constants";
import {
  AvailabilityBadge,
  PriorityBadge,
  StatusBadge,
  VehicleStatusBadge,
  VehicleTypeLabel,
} from "@/components/fleetflow/badges";
import { friendlyDueDate, initials, timeAgo } from "@/lib/format";
import { AssignDialog } from "@/components/fleetflow/assign-dialog";
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type ActiveAssignment = AssignmentHistoryItem & { delivery: Delivery };

export function DispatchView() {
  const { data, loading, error } = useApiData<DispatchData>("/api/dispatch");

  const [assignTarget, setAssignTarget] = useState<Delivery | null>(null);
  const [unassignTarget, setUnassignTarget] = useState<ActiveAssignment | null>(null);
  const [unassignReason, setUnassignReason] = useState("");
  const [busy, setBusy] = useState(false);

  const unassigned = data?.unassigned ?? [];
  const assignments = data?.assignments ?? [];
  const drivers = data?.drivers ?? [];
  const vehicles = data?.vehicles ?? [];

  const pendingCount = unassigned.filter((d) => d.status === "CREATED").length;
  const failedCount = unassigned.filter((d) => d.status === "FAILED").length;
  const activeCount = assignments.length;

  async function handleUnassign() {
    if (!unassignTarget) return;
    const deliveryId = unassignTarget.delivery.id;
    const reason = unassignReason.trim();
    setBusy(true);
    try {
      await api.post(`/api/deliveries/${deliveryId}/unassign`, reason ? { reason } : {});
      toast.success("Driver unassigned — delivery returned to the queue");
      useAppStore.getState().bump();
      setUnassignTarget(null);
      setUnassignReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to unassign");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-44 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/40 p-4 text-sm text-destructive">
        Couldn&apos;t load the dispatch board: {error}
      </Card>
    );
  }

  const now = Date.now();
  const isOverdue = (d: Delivery) => !!d.expectedAt && new Date(d.expectedAt).getTime() < now;

  return (
    <div className="space-y-4">
      {/* Stat chips */}
      <div className="flex flex-wrap gap-3">
        <Card className="flex min-w-40 flex-1 flex-row items-center gap-3 border-amber-200 bg-amber-50/70 p-4 sm:flex-none dark:border-amber-900 dark:bg-amber-950/20">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
            <Clock className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-2xl leading-none font-semibold tabular-nums">{pendingCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">pending assignment</p>
          </div>
        </Card>

        <Card className="flex min-w-40 flex-1 flex-row items-center gap-3 border-rose-200 bg-rose-50/70 p-4 sm:flex-none dark:border-rose-900 dark:bg-rose-950/20">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300">
            <AlertTriangle className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-2xl leading-none font-semibold tabular-nums">{failedCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">failed — awaiting reassignment</p>
          </div>
        </Card>

        <Card className="flex min-w-40 flex-1 flex-row items-center gap-3 border-emerald-200 bg-emerald-50/70 p-4 sm:flex-none dark:border-emerald-900 dark:bg-emerald-950/20">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
            <Truck className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-2xl leading-none font-semibold tabular-nums">{activeCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">active assignments</p>
          </div>
        </Card>
      </div>

      {/* Dispatch queue */}
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b">
          <CardTitle>Dispatch queue</CardTitle>
          <CardDescription>Pending and failed deliveries awaiting a driver</CardDescription>
        </CardHeader>

        {unassigned.length === 0 ? (
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <CheckCircle2 className="size-8 text-primary" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Queue is clear — every delivery is dispatched 🎉
            </p>
          </CardContent>
        ) : (
          <>
            {/* Desktop table */}
            <CardContent className="hidden p-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4">Tracking</TableHead>
                    <TableHead className="px-4">Recipient</TableHead>
                    <TableHead className="px-4">Priority</TableHead>
                    <TableHead className="px-4">Status</TableHead>
                    <TableHead className="px-4">Expected</TableHead>
                    <TableHead className="px-4 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unassigned.map((d) => (
                    <TableRow key={d.id} className="hover:bg-accent/50">
                      <TableCell className="px-4 py-3 font-mono text-sm font-medium">{d.trackingCode}</TableCell>
                      <TableCell className="px-4 py-3">
                        <div className="font-medium">{d.recipientName}</div>
                        {d.status === "FAILED" ? (
                          <div className="text-xs text-rose-600 dark:text-rose-400">
                            {failureReasonLabel(d.failureReason)}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <PriorityBadge priority={d.priority} />
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <StatusBadge status={d.status} />
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <div>{friendlyDueDate(d.expectedAt)}</div>
                        {isOverdue(d) ? (
                          <div className="text-xs font-medium text-rose-600 dark:text-rose-400">Overdue</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right">
                        <Button size="sm" className="min-h-11" onClick={() => setAssignTarget(d)}>
                          <UserCheck /> Assign
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>

            {/* Mobile cards */}
            <CardContent className="grid gap-3 p-4 md:hidden">
              {unassigned.map((d) => (
                <div key={d.id} className="space-y-2 rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-medium">{d.trackingCode}</span>
                    <StatusBadge status={d.status} />
                  </div>
                  <p className="font-medium">{d.recipientName}</p>
                  {d.status === "FAILED" ? (
                    <p className="text-xs text-rose-600 dark:text-rose-400">
                      {failureReasonLabel(d.failureReason)}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <PriorityBadge priority={d.priority} />
                    <span>{friendlyDueDate(d.expectedAt)}</span>
                    {isOverdue(d) ? (
                      <span className="font-medium text-rose-600 dark:text-rose-400">Overdue</span>
                    ) : null}
                  </div>
                  <Button size="sm" className="min-h-11 self-start" onClick={() => setAssignTarget(d)}>
                    <UserCheck /> Assign
                  </Button>
                </div>
              ))}
            </CardContent>
          </>
        )}
      </Card>

      {/* Active assignments */}
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b">
          <CardTitle>On the road</CardTitle>
          <CardDescription>Currently assigned deliveries moving through the pipeline</CardDescription>
        </CardHeader>

        {assignments.length === 0 ? (
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No active assignments
          </CardContent>
        ) : (
          <>
            {/* Desktop table */}
            <CardContent className="hidden p-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4">Delivery</TableHead>
                    <TableHead className="px-4">Driver</TableHead>
                    <TableHead className="px-4">Vehicle</TableHead>
                    <TableHead className="px-4">Status</TableHead>
                    <TableHead className="px-4">Assigned</TableHead>
                    <TableHead className="px-4 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments.map((a) => (
                    <TableRow key={a.id} className="hover:bg-accent/50">
                      <TableCell className="px-4 py-3">
                        <div className="font-mono text-sm font-medium">{a.delivery.trackingCode}</div>
                        <div className="text-xs text-muted-foreground">{a.delivery.recipientName}</div>
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar className="size-8">
                            <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                              {initials(a.driverName)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{a.driverName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <div className="font-mono text-sm">{a.vehicleRegistration}</div>
                        <div className="text-xs text-muted-foreground">
                          <VehicleTypeLabel type={a.vehicleType} />
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <StatusBadge status={a.delivery.status} />
                      </TableCell>
                      <TableCell className="px-4 py-3 text-muted-foreground">{timeAgo(a.assignedAt)}</TableCell>
                      <TableCell className="px-4 py-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11"
                          onClick={() => {
                            setUnassignTarget(a);
                            setUnassignReason("");
                          }}
                        >
                          <UserX /> Unassign
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>

            {/* Mobile cards */}
            <CardContent className="grid gap-3 p-4 md:hidden">
              {assignments.map((a) => (
                <div key={a.id} className="space-y-2 rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-medium">{a.delivery.trackingCode}</span>
                    <StatusBadge status={a.delivery.status} />
                  </div>
                  <p className="text-sm text-muted-foreground">{a.delivery.recipientName}</p>
                  <div className="flex items-center gap-2">
                    <Avatar className="size-7">
                      <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                        {initials(a.driverName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">{a.driverName}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{a.vehicleRegistration}</span> ·{" "}
                    <VehicleTypeLabel type={a.vehicleType} />
                  </p>
                  <p className="text-xs text-muted-foreground">assigned {timeAgo(a.assignedAt)}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 self-start"
                    onClick={() => {
                      setUnassignTarget(a);
                      setUnassignReason("");
                    }}
                  >
                    <UserX /> Unassign
                  </Button>
                </div>
              ))}
            </CardContent>
          </>
        )}
      </Card>

      {/* Fleet snapshot */}
      <Card>
        <CardHeader>
          <CardTitle>Fleet snapshot</CardTitle>
          <CardDescription>Driver workload and vehicle availability right now</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <section aria-labelledby="dispatch-drivers-heading">
            <h3 id="dispatch-drivers-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Users className="size-4 text-primary" aria-hidden /> Drivers
            </h3>
            {drivers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No drivers yet.</p>
            ) : (
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                {drivers.map((dr) => {
                  const offDuty = dr.availability === "OFF_DUTY" || !dr.active;
                  const atCapacity = dr.activeJobs >= dr.maxActiveJobs;
                  return (
                    <div
                      key={dr.id}
                      className={cn(
                        "rounded-lg border p-3",
                        offDuty
                          ? "border-rose-200/70 bg-rose-50/60 dark:border-rose-900/50 dark:bg-rose-950/20"
                          : atCapacity
                            ? "border-amber-200/70 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20"
                            : "",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{dr.name}</span>
                        <AvailabilityBadge availability={dr.availability} />
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Progress
                          value={(dr.activeJobs / Math.max(1, dr.maxActiveJobs)) * 100}
                          className={cn(
                            "h-1.5 flex-1",
                            offDuty && "[&_[data-slot=progress-indicator]]:bg-rose-500",
                            !offDuty && atCapacity && "[&_[data-slot=progress-indicator]]:bg-amber-500",
                          )}
                        />
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {dr.activeJobs}/{dr.maxActiveJobs}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="dispatch-vehicles-heading">
            <h3 id="dispatch-vehicles-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Truck className="size-4 text-primary" aria-hidden /> Vehicles
            </h3>
            {vehicles.length === 0 ? (
              <p className="text-sm text-muted-foreground">No vehicles yet.</p>
            ) : (
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                {vehicles.map((v) => (
                  <div
                    key={v.id}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg border p-3",
                      v.status !== "ACTIVE" && "opacity-60",
                    )}
                  >
                    <div className="min-w-0">
                      <span className="font-mono text-sm font-medium">{v.registrationNumber}</span>
                      <p className="truncate text-xs text-muted-foreground">
                        <VehicleTypeLabel type={v.type} />
                        {v.capacity ? ` · ${v.capacity}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <VehicleStatusBadge status={v.status} />
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {v.activeJobs} active
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </CardContent>
      </Card>

      {/* Assign dialog (opened from queue rows) */}
      <AssignDialog
        delivery={assignTarget}
        open={!!assignTarget}
        onOpenChange={(o) => {
          if (!o) setAssignTarget(null);
        }}
      />

      {/* Unassign dialog */}
      <AlertDialog
        open={!!unassignTarget}
        onOpenChange={(o) => {
          if (!o) {
            setUnassignTarget(null);
            setUnassignReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unassign driver?</AlertDialogTitle>
            <AlertDialogDescription>
              {unassignTarget
                ? `${unassignTarget.driverName} will be released from ${unassignTarget.delivery.trackingCode} and the delivery returns to the dispatch queue.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dispatch-unassign-reason">Reason (optional)</Label>
            <Input
              id="dispatch-unassign-reason"
              value={unassignReason}
              onChange={(e) => setUnassignReason(e.target.value)}
              placeholder="e.g. Vehicle breakdown, driver shift ended"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 sm:min-h-9">Keep assignment</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 sm:min-h-9"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void handleUnassign();
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : <UserX />} Unassign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default DispatchView;
