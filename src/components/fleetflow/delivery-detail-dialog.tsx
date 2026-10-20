"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Ban,
  Camera,
  Circle,
  Copy,
  Link2,
  Loader2,
  PenLine,
  ShieldAlert,
  StickyNote,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";

import { api, useApiData } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import type { DeliveryDetail, PodItem } from "@/lib/types";
import type { DeliveryStatus } from "@/lib/constants";
import {
  EVENT_TYPE_LABELS,
  FAILURE_REASONS,
  STATUS_LABELS,
  failureReasonLabel,
} from "@/lib/constants";
import { PriorityBadge, STATUS_ICONS, StatusBadge, VehicleTypeLabel } from "@/components/fleetflow/badges";
import { formatDateTime, friendlyDueDate, timeAgo, truncate } from "@/lib/format";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Statuses an admin may force a delivery into via the audited override path.
const OVERRIDE_TARGETS: DeliveryStatus[] = ["DELIVERED", "FAILED", "CANCELLED", "IN_TRANSIT", "PICKED_UP"];

const EVENT_CIRCLE_STYLES: Record<string, string> = {
  CREATED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  ASSIGNED: "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300",
  UNASSIGNED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  PICKED_UP: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  IN_TRANSIT: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300",
  DELIVERED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  FAILED: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  CANCELLED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  NOTE: "bg-primary/10 text-primary",
  OVERRIDE: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  TRACKING_UPDATED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words">{children}</dd>
    </div>
  );
}

export function DeliveryDetailDialog({
  deliveryId,
  open,
  onOpenChange,
}: {
  deliveryId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data, loading, error, reload } = useApiData<DeliveryDetail>(
    open && deliveryId ? `/api/deliveries/${deliveryId}` : null,
  );

  const [busy, setBusy] = useState(false);

  // Sub-dialog state (cleaned up on close so nothing leaks between rows)
  const [assignOpen, setAssignOpen] = useState(false);
  const [unassignOpen, setUnassignOpen] = useState(false);
  const [unassignReason, setUnassignReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteVisible, setNoteVisible] = useState(false);
  const [noteError, setNoteError] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideFailure, setOverrideFailure] = useState("");
  const [overrideErrors, setOverrideErrors] = useState({ status: false, reason: false, failure: false });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [podPreview, setPodPreview] = useState<PodItem | null>(null);

  const delivery = data?.delivery ?? null;
  const status = delivery?.status ?? "";
  const events = [...(data?.events ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const pods = data?.pods ?? [];
  const trackingUrl = delivery?.trackingToken
    ? `${typeof window === "undefined" ? "" : window.location.origin}/?track=${delivery.trackingToken}`
    : "";

  const showSkeleton = loading || !data;

  // ── helpers ───────────────────────────────────────────────

  async function runMutation(fn: () => Promise<unknown>, success: string, after?: () => void) {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      useAppStore.getState().bump();
      await reload();
      after?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function closeAll() {
    setAssignOpen(false);
    setUnassignOpen(false);
    setUnassignReason("");
    setCancelOpen(false);
    setCancelReason("");
    setCancelError(false);
    setNoteOpen(false);
    setNoteText("");
    setNoteVisible(false);
    setNoteError(false);
    setOverrideOpen(false);
    setOverrideStatus("");
    setOverrideReason("");
    setOverrideFailure("");
    setOverrideErrors({ status: false, reason: false, failure: false });
    setDeleteOpen(false);
    setPodPreview(null);
  }

  function handleMainOpenChange(o: boolean) {
    if (o) {
      onOpenChange(true);
      return;
    }
    closeAll();
    onOpenChange(false);
  }

  // ── mutations ─────────────────────────────────────────────

  function handleUnassign() {
    if (!deliveryId) return;
    const reason = unassignReason.trim();
    void runMutation(
      () => api.post(`/api/deliveries/${deliveryId}/unassign`, reason ? { reason } : {}),
      "Driver unassigned — delivery returned to the queue",
      () => {
        setUnassignOpen(false);
        setUnassignReason("");
      },
    );
  }

  function handleCancelDelivery() {
    if (!deliveryId) return;
    if (!cancelReason.trim()) {
      setCancelError(true);
      return;
    }
    void runMutation(
      () => api.post(`/api/deliveries/${deliveryId}/status`, { status: "CANCELLED", note: cancelReason.trim() }),
      "Delivery cancelled",
      () => {
        setCancelOpen(false);
        setCancelReason("");
        setCancelError(false);
      },
    );
  }

  function handleAddNote() {
    if (!deliveryId) return;
    if (!noteText.trim()) {
      setNoteError(true);
      return;
    }
    void runMutation(
      () => api.post(`/api/deliveries/${deliveryId}/note`, { note: noteText.trim(), customerVisible: noteVisible }),
      noteVisible ? "Note added (visible to customer)" : "Internal note added",
      () => {
        setNoteOpen(false);
        setNoteText("");
        setNoteVisible(false);
        setNoteError(false);
      },
    );
  }

  function handleOverride() {
    if (!deliveryId) return;
    const errs = {
      status: !overrideStatus,
      reason: !overrideReason.trim(),
      failure: overrideStatus === "FAILED" && !overrideFailure,
    };
    setOverrideErrors(errs);
    if (errs.status || errs.reason || errs.failure) return;
    void runMutation(
      () =>
        api.post(`/api/deliveries/${deliveryId}/status`, {
          status: overrideStatus,
          note: overrideReason.trim(),
          ...(overrideStatus === "FAILED" ? { failureReason: overrideFailure } : {}),
        }),
      `Status overridden to ${STATUS_LABELS[overrideStatus as DeliveryStatus] ?? overrideStatus}`,
      () => {
        setOverrideOpen(false);
        setOverrideStatus("");
        setOverrideReason("");
        setOverrideFailure("");
        setOverrideErrors({ status: false, reason: false, failure: false });
      },
    );
  }

  function handleDelete() {
    if (!deliveryId) return;
    void runMutation(
      () => api.del(`/api/deliveries/${deliveryId}`),
      "Delivery deleted",
      () => {
        setDeleteOpen(false);
        handleMainOpenChange(false);
      },
    );
  }

  function handleTrackingAction(action: "regenerate" | "revoke" | "restore") {
    if (!deliveryId) return;
    void runMutation(
      () => api.post(`/api/deliveries/${deliveryId}/tracking`, { action }),
      action === "revoke"
        ? "Tracking link revoked"
        : action === "restore"
          ? "Tracking link restored"
          : "Tracking link regenerated — the old link no longer works",
    );
  }

  async function copyTrackingLink() {
    try {
      await navigator.clipboard.writeText(trackingUrl);
      toast.success("Tracking link copied to clipboard");
    } catch {
      toast.error("Couldn't copy — please select the link text manually");
    }
  }

  const canAssign = status === "CREATED" || status === "FAILED";
  const canUnassign = status === "ASSIGNED" || status === "PICKED_UP" || status === "IN_TRANSIT";
  const overrideTargets = OVERRIDE_TARGETS.filter((s) => s !== status);

  // ── render ────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleMainOpenChange}>
        <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-xl lg:max-w-2xl" aria-describedby={undefined}>
          <DialogHeader className="pr-6">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {delivery ? (
                <>
                  <span className="font-mono">{delivery.trackingCode}</span>
                  <StatusBadge status={delivery.status} />
                  <PriorityBadge priority={delivery.priority} />
                </>
              ) : (
                "Delivery details"
              )}
            </DialogTitle>
            <DialogDescription>
              {delivery
                ? `${delivery.recipientName} — ${truncate(delivery.deliveryAddress, 90)}`
                : "Full delivery lifecycle: assignment, tracking, proof and history."}
            </DialogDescription>
          </DialogHeader>

          {showSkeleton ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                ))}
              </div>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              Couldn&apos;t load this delivery: {error}
            </div>
          ) : delivery ? (
            <div className="space-y-4">
              {/* Info grid */}
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <Field label="Recipient">
                  <span className="font-medium">{delivery.recipientName}</span>
                  <br />
                  <a
                    href={`tel:${delivery.recipientPhone}`}
                    className="text-primary hover:underline"
                    aria-label={`Call ${delivery.recipientName} at ${delivery.recipientPhone}`}
                  >
                    {delivery.recipientPhone}
                  </a>
                </Field>
                <Field label="Pickup address">{delivery.pickupAddress}</Field>
                <Field label="Delivery address">{delivery.deliveryAddress}</Field>
                <Field label="Expected">{friendlyDueDate(delivery.expectedAt)}</Field>
                <Field label="Created">{formatDateTime(delivery.createdAt)}</Field>
                <Field label="Completed">{delivery.completedAt ? formatDateTime(delivery.completedAt) : "—"}</Field>
                <Field label="Instructions" className="sm:col-span-2">
                  {delivery.instructions ? (
                    <span className="italic text-muted-foreground">{delivery.instructions}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Field>
                {delivery.failureReason ? (
                  <Field label="Failure reason" className="sm:col-span-2">
                    <span className="font-medium text-rose-600 dark:text-rose-400">
                      {failureReasonLabel(delivery.failureReason)}
                    </span>
                  </Field>
                ) : null}
              </dl>

              {/* Current assignment */}
              <div className="rounded-lg border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Current assignment
                </p>
                {delivery.assignment ? (
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                    <span className="font-medium">{delivery.assignment.driverName}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-mono text-xs">{delivery.assignment.vehicleRegistration}</span>
                    <span className="text-xs text-muted-foreground">
                      (<VehicleTypeLabel type={delivery.assignment.vehicleType} />)
                    </span>
                    <span className="text-muted-foreground">· assigned {timeAgo(delivery.assignment.assignedAt)}</span>
                  </div>
                ) : (
                  <p className="mt-1.5 text-sm text-muted-foreground">Not assigned</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                {canAssign ? (
                  <Button className="min-h-11 sm:min-h-9" onClick={() => setAssignOpen(true)}>
                    <UserCheck /> Assign driver &amp; vehicle
                  </Button>
                ) : null}
                {canUnassign ? (
                  <Button
                    variant="outline"
                    className="min-h-11 sm:min-h-9"
                    onClick={() => setUnassignOpen(true)}
                  >
                    <UserX /> Unassign
                  </Button>
                ) : null}
                {canAssign ? (
                  <Button
                    variant="outline"
                    className="min-h-11 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:min-h-9"
                    onClick={() => setCancelOpen(true)}
                  >
                    <Ban /> Cancel delivery
                  </Button>
                ) : null}
                <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setNoteOpen(true)}>
                  <StickyNote /> Add note
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11 border-amber-500/40 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 sm:min-h-9 dark:text-amber-400 dark:hover:text-amber-300"
                  onClick={() => setOverrideOpen(true)}
                >
                  <ShieldAlert /> Override (audited)
                </Button>
                {status === "CREATED" ? (
                  <Button
                    variant="ghost"
                    className="min-h-11 text-destructive hover:bg-destructive/10 hover:text-destructive sm:min-h-9"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 /> Delete
                  </Button>
                ) : null}
              </div>

              {/* Tracking link */}
              {delivery.trackingToken ? (
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Customer tracking link
                    </p>
                    {delivery.trackingEnabled ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                      >
                        <Link2 className="size-3" /> Active
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                      >
                        Revoked
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={trackingUrl}
                      className="min-h-11 font-mono text-xs sm:min-h-9"
                      aria-label="Customer tracking link"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 shrink-0 sm:min-h-9"
                      onClick={() => void copyTrackingLink()}
                    >
                      <Copy /> Copy
                    </Button>
                  </div>
                  {!delivery.trackingEnabled ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Link revoked — customer sees a &ldquo;revoked&rdquo; message
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {delivery.trackingEnabled ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={busy}
                        onClick={() => handleTrackingAction("revoke")}
                      >
                        Revoke link
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11"
                        disabled={busy}
                        onClick={() => handleTrackingAction("restore")}
                      >
                        Restore link
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      disabled={busy}
                      onClick={() => handleTrackingAction("regenerate")}
                    >
                      Regenerate
                    </Button>
                  </div>
                </div>
              ) : null}

              {/* Proof of delivery */}
              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Proof of delivery
                </p>
                {pods.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No proof uploaded yet</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {pods.map((pod) => (
                      <button
                        key={pod.id}
                        type="button"
                        className="group space-y-1.5 rounded-lg text-left transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setPodPreview(pod)}
                        aria-label={`View ${pod.kind === "SIGNATURE" ? "signature" : "photo"} proof from ${pod.recipientName}`}
                      >
                        { }
                        <img
                          src={`/api/pod/${pod.id}`}
                          alt={`${pod.kind === "SIGNATURE" ? "Signature" : "Photo"} proof of delivery — ${pod.recipientName}`}
                          className="h-28 w-full rounded-lg border bg-white object-contain p-1"
                        />
                        <span className="flex items-center gap-1.5 text-xs font-medium">
                          {pod.kind === "SIGNATURE" ? (
                            <PenLine className="size-3.5 text-primary" />
                          ) : (
                            <Camera className="size-3.5 text-primary" />
                          )}
                          {pod.kind === "SIGNATURE" ? "Signature" : "Photo"}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{pod.recipientName}</span>
                        <span className="block text-xs text-muted-foreground">{formatDateTime(pod.capturedAt)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Event timeline */}
              <div className="rounded-lg border p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Timeline · newest first
                </p>
                {events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No events recorded.</p>
                ) : (
                  <ol className="max-h-80 space-y-0 overflow-y-auto pr-1">
                    {events.map((ev, i) => {
                      const Icon = STATUS_ICONS[ev.eventType];
                      const last = i === events.length - 1;
                      return (
                        <li key={ev.id} className="relative flex gap-3 pb-4 last:pb-0">
                          {!last ? (
                            <span
                              aria-hidden
                              className="absolute bottom-0 left-[15px] top-9 w-px bg-border"
                            />
                          ) : null}
                          <span
                            className={cn(
                              "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full",
                              EVENT_CIRCLE_STYLES[ev.eventType] ??
                                "bg-muted text-muted-foreground",
                            )}
                          >
                            {Icon ? <Icon className="size-4" /> : <Circle className="size-3" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {ev.eventType === "OVERRIDE" ? (
                                <Badge
                                  variant="outline"
                                  className="border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                                >
                                  {EVENT_TYPE_LABELS[ev.eventType] ?? ev.eventType}
                                </Badge>
                              ) : (
                                <span className="text-sm font-medium">
                                  {EVENT_TYPE_LABELS[ev.eventType] ?? ev.eventType}
                                </span>
                              )}
                              {ev.customerVisible ? (
                                <Badge
                                  variant="outline"
                                  className="border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                                >
                                  Customer-visible
                                </Badge>
                              ) : null}
                            </div>
                            {ev.note ? (
                              <p className="mt-0.5 break-words text-sm text-muted-foreground">{ev.note}</p>
                            ) : null}
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {ev.actorName ?? "System"} · {formatDateTime(ev.createdAt)} ({timeAgo(ev.createdAt)})
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          ) : null}

          {/* ── nested dialogs ─────────────────────────────── */}

          <AssignDialog delivery={delivery} open={assignOpen} onOpenChange={setAssignOpen} />

          {/* Unassign */}
          <AlertDialog
            open={unassignOpen}
            onOpenChange={(o) => {
              setUnassignOpen(o);
              if (!o) setUnassignReason("");
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unassign driver?</AlertDialogTitle>
                <AlertDialogDescription>
                  {delivery?.assignment?.driverName ?? "The driver"} will be released and the delivery returns to
                  the dispatch queue for reassignment.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2">
                <Label htmlFor="unassign-reason">Reason (optional)</Label>
                <Input
                  id="unassign-reason"
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
                    handleUnassign();
                  }}
                >
                  {busy ? <Loader2 className="animate-spin" /> : <UserX />} Unassign
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Cancel delivery */}
          <AlertDialog
            open={cancelOpen}
            onOpenChange={(o) => {
              setCancelOpen(o);
              if (!o) {
                setCancelReason("");
                setCancelError(false);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel this delivery?</AlertDialogTitle>
                <AlertDialogDescription>
                  The customer tracking page will show the delivery as cancelled. A reason is required and is
                  stored with the record.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2">
                <Label htmlFor="cancel-reason">
                  Reason <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="cancel-reason"
                  value={cancelReason}
                  onChange={(e) => {
                    setCancelReason(e.target.value);
                    if (e.target.value.trim()) setCancelError(false);
                  }}
                  aria-invalid={cancelError}
                  placeholder="e.g. Duplicate order, customer request"
                  className={cn("min-h-11 sm:min-h-9", cancelError && "border-destructive focus-visible:ring-destructive/30")}
                />
                {cancelError ? <p className="text-xs text-destructive">A reason is required to cancel.</p> : null}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-11 sm:min-h-9">Keep delivery</AlertDialogCancel>
                <AlertDialogAction
                  className="min-h-11 bg-destructive text-white hover:bg-destructive/90 sm:min-h-9"
                  disabled={busy}
                  onClick={(e) => {
                    e.preventDefault();
                    handleCancelDelivery();
                  }}
                >
                  {busy ? <Loader2 className="animate-spin" /> : <Ban />} Cancel delivery
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Add note */}
          <Dialog
            open={noteOpen}
            onOpenChange={(o) => {
              setNoteOpen(o);
              if (!o) {
                setNoteText("");
                setNoteVisible(false);
                setNoteError(false);
              }
            }}
          >
            <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
              <DialogHeader>
                <DialogTitle>Add note</DialogTitle>
                <DialogDescription>
                  Notes appear in the timeline. Customer-visible notes also show on the public tracking page.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="note-text">
                  Note <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="note-text"
                  value={noteText}
                  onChange={(e) => {
                    setNoteText(e.target.value);
                    if (e.target.value.trim()) setNoteError(false);
                  }}
                  aria-invalid={noteError}
                  placeholder="e.g. Customer requested delivery after 2 PM"
                  className={cn(noteError && "border-destructive focus-visible:ring-destructive/30")}
                />
                {noteError ? <p className="text-xs text-destructive">The note can&apos;t be empty.</p> : null}
              </div>
              <label
                htmlFor="note-customer-visible"
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md text-sm"
              >
                <Checkbox
                  id="note-customer-visible"
                  checked={noteVisible}
                  onCheckedChange={(v) => setNoteVisible(v === true)}
                />
                Visible to customer on tracking page
              </label>
              <DialogFooter>
                <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => setNoteOpen(false)}>
                  Discard
                </Button>
                <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={handleAddNote}>
                  {busy ? <Loader2 className="animate-spin" /> : <StickyNote />} Save note
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Override status */}
          <Dialog
            open={overrideOpen}
            onOpenChange={(o) => {
              setOverrideOpen(o);
              if (!o) {
                setOverrideStatus("");
                setOverrideReason("");
                setOverrideFailure("");
                setOverrideErrors({ status: false, reason: false, failure: false });
              }
            }}
          >
            <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldAlert className="size-5 text-amber-600 dark:text-amber-400" />
                  Override status (audited)
                </DialogTitle>
                <DialogDescription>
                  Force this delivery into a different status, bypassing the normal driver workflow.
                </DialogDescription>
              </DialogHeader>

              <p className="text-xs text-muted-foreground">Overrides are recorded in the audit log.</p>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="override-status">
                    Target status <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={overrideStatus}
                    onValueChange={(v) => {
                      setOverrideStatus(v);
                      setOverrideErrors((e) => ({ ...e, status: false }));
                    }}
                  >
                    <SelectTrigger id="override-status" className={cn("w-full min-h-11 sm:min-h-9", overrideErrors.status && "border-destructive")}>
                      <SelectValue placeholder="Select target status" />
                    </SelectTrigger>
                    <SelectContent>
                      {overrideTargets.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {overrideErrors.status ? <p className="text-xs text-destructive">Pick a target status.</p> : null}
                </div>

                {overrideStatus === "FAILED" ? (
                  <div className="space-y-2">
                    <Label htmlFor="override-failure">
                      Failure reason <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={overrideFailure}
                      onValueChange={(v) => {
                        setOverrideFailure(v);
                        setOverrideErrors((e) => ({ ...e, failure: false }));
                      }}
                    >
                      <SelectTrigger id="override-failure" className={cn("w-full min-h-11 sm:min-h-9", overrideErrors.failure && "border-destructive")}>
                        <SelectValue placeholder="Select failure reason" />
                      </SelectTrigger>
                      <SelectContent>
                        {FAILURE_REASONS.map((r) => (
                          <SelectItem key={r.code} value={r.code}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {overrideErrors.failure ? <p className="text-xs text-destructive">Pick a failure reason.</p> : null}
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="override-reason">
                    Reason <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="override-reason"
                    value={overrideReason}
                    onChange={(e) => {
                      setOverrideReason(e.target.value);
                      if (e.target.value.trim()) setOverrideErrors((er) => ({ ...er, reason: false }));
                    }}
                    aria-invalid={overrideErrors.reason}
                    placeholder="e.g. Confirmed by phone — driver forgot to scan"
                    className={cn(overrideErrors.reason && "border-destructive focus-visible:ring-destructive/30")}
                  />
                  {overrideErrors.reason ? <p className="text-xs text-destructive">A reason is mandatory for overrides.</p> : null}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => setOverrideOpen(false)}>
                  Cancel
                </Button>
                <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={handleOverride}>
                  {busy ? <Loader2 className="animate-spin" /> : <ShieldAlert />} Apply override
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Delete */}
          <AlertDialog
            open={deleteOpen}
            onOpenChange={(o) => {
              setDeleteOpen(o);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this delivery?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes {delivery ? delivery.trackingCode : "the delivery"}, its events and its
                  tracking link. Only deliveries that were never assigned can be deleted — use Cancel otherwise.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-11 sm:min-h-9">Keep delivery</AlertDialogCancel>
                <AlertDialogAction
                  className="min-h-11 bg-destructive text-white hover:bg-destructive/90 sm:min-h-9"
                  disabled={busy}
                  onClick={(e) => {
                    e.preventDefault();
                    handleDelete();
                  }}
                >
                  {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* POD preview */}
          <Dialog
            open={!!podPreview}
            onOpenChange={(o) => {
              if (!o) setPodPreview(null);
            }}
          >
            <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
              <DialogHeader className="pr-6">
                <DialogTitle className="flex items-center gap-2">
                  {podPreview?.kind === "SIGNATURE" ? (
                    <PenLine className="size-5 text-primary" />
                  ) : (
                    <Camera className="size-5 text-primary" />
                  )}
                  Proof of delivery
                </DialogTitle>
                <DialogDescription>
                  {podPreview
                    ? `${podPreview.recipientName} · ${formatDateTime(podPreview.capturedAt)}`
                    : ""}
                </DialogDescription>
              </DialogHeader>
              {podPreview ? (
                 
                <img
                  src={`/api/pod/${podPreview.id}`}
                  alt={`${podPreview.kind === "SIGNATURE" ? "Signature" : "Photo"} proof of delivery — ${podPreview.recipientName}`}
                  className="max-h-[65vh] w-full rounded-lg border bg-white object-contain p-2"
                />
              ) : null}
            </DialogContent>
          </Dialog>
        </DialogContent>
    </Dialog>
  );
}
