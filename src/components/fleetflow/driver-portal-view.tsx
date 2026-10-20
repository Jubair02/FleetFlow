"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  AlertTriangle,
  ArrowUpFromLine,
  CheckCircle2,
  Clock,
  Eraser,
  History,
  Info,
  Loader2,
  MapPin,
  PackageCheck,
  Phone,
  RefreshCw,
  Truck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, useApiData } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import { EVENT_TYPE_LABELS, FAILURE_REASONS, failureReasonLabel } from "@/lib/constants";
import { formatDateTime, friendlyDueDate } from "@/lib/format";
import type { Delivery, DeliveryDetail, MyJob } from "@/lib/types";
import { PriorityBadge, StatusBadge, VehicleTypeLabel } from "@/components/fleetflow/badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

// ─────────────────────────────────────────────────────────────
// Small shared pieces
// ─────────────────────────────────────────────────────────────

function isOverdue(job: Delivery): boolean {
  if (!job.expectedAt) return false;
  if (job.status === "DELIVERED" || job.status === "FAILED" || job.status === "CANCELLED") return false;
  return new Date(job.expectedAt).getTime() < Date.now();
}

/** Pickup → dropoff route block with a dashed connector (used by cards + detail dialog). */
function RouteBlock({ job }: { job: Delivery }) {
  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted" aria-hidden="true">
          <ArrowUpFromLine className="size-3.5 text-muted-foreground" />
        </span>
        <p className="min-w-0 pt-0.5 text-sm leading-snug text-muted-foreground">{job.pickupAddress}</p>
      </div>
      <div className="ml-[11px] h-4 border-l-2 border-dashed border-border" aria-hidden="true" />
      <div className="flex items-start gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted" aria-hidden="true">
          <MapPin className="size-3.5 text-muted-foreground" />
        </span>
        <p className="min-w-0 pt-0.5 text-sm font-medium leading-snug">{job.deliveryAddress}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 pl-9">
        <span className="text-sm font-semibold">{job.recipientName}</span>
        {job.recipientPhone ? (
          <Button asChild variant="outline" size="sm" className="min-h-11 gap-1.5">
            <a href={`tel:${job.recipientPhone}`}>
              <Phone className="size-3.5" aria-hidden="true" />
              {job.recipientPhone}
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Vehicle + expected-time meta row and the amber instructions callout. */
function MetaBlock({
  job,
  registration,
  vehicleType,
}: {
  job: Delivery;
  registration?: string | null;
  vehicleType?: string | null;
}) {
  const overdue = isOverdue(job);
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {registration ? (
          <span className="inline-flex items-center gap-1.5">
            <Truck className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="font-mono font-medium text-foreground">{registration}</span>
            {vehicleType ? (
              <span>
                · <VehicleTypeLabel type={vehicleType} />
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          Expected:{" "}
          <span className={cn("font-medium", overdue ? "text-rose-600 dark:text-rose-400" : "text-foreground")}>
            {friendlyDueDate(job.expectedAt)}
            {overdue ? " (overdue)" : ""}
          </span>
        </span>
      </div>
      {job.instructions ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm italic text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <Info className="mt-0.5 size-4 shrink-0 not-italic" aria-hidden="true" />
          <span className="min-w-0 break-words">{job.instructions}</span>
        </div>
      ) : null}
    </div>
  );
}

function JobListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading jobs">
      {Array.from({ length: rows }).map((_, i) => (
        <Card key={i} className="p-5">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="mt-5 flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Signature pad — pointer events (touch + mouse + stylus),
// devicePixelRatio-scaled canvas, strokes stored for crisp redraws.
// ─────────────────────────────────────────────────────────────

function SignaturePad({
  canvasRef,
  onInkChange,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onInkChange: (hasInk: boolean) => void;
}) {
  const strokesRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const drawingRef = useRef(false);
  const [inked, setInked] = useState(false);

  const applyStyle = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#1e293b";
    ctx.fillStyle = "#1e293b";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    applyStyle(ctx);
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (const stroke of strokesRef.current) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      if (stroke.length === 1) {
        ctx.arc(stroke[0].x, stroke[0].y, 1.25, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
      ctx.stroke();
    }
  }, [applyStyle, canvasRef]);

  // Scale the backing store by devicePixelRatio for crisp lines; re-run on resize
  // (dialog open animation, rotation) and replay stored strokes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef, redraw]);

  const pointerPos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    drawingRef.current = true;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    applyStyle(ctx);
    const p = pointerPos(e);
    strokesRef.current.push([p]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.25, 0, Math.PI * 2);
    ctx.fill();
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    const ctx = e.currentTarget.getContext("2d");
    if (!stroke || !ctx) return;
    const p = pointerPos(e);
    const prev = stroke[stroke.length - 1];
    applyStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    stroke.push(p);
    if (stroke.length >= 2 && !inked) {
      setInked(true);
      onInkChange(true);
    }
  };

  const endStroke = () => {
    drawingRef.current = false;
  };

  const clear = () => {
    strokesRef.current = [];
    drawingRef.current = false;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      const rect = canvas.getBoundingClientRect();
      applyStyle(ctx);
      ctx.clearRect(0, 0, rect.width, rect.height);
    }
    setInked(false);
    onInkChange(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>Recipient signature</Label>
        <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5" onClick={clear}>
          <Eraser className="size-3.5" aria-hidden="true" /> Clear
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onLostPointerCapture={endStroke}
        className="h-44 w-full touch-none cursor-crosshair rounded-lg border bg-white"
        role="img"
        aria-label="Signature pad — draw the recipient's signature with your finger or a stylus"
      />
      <p className="text-xs text-muted-foreground">Draw with a finger or stylus — a signature or a photo is required.</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// POD dialog — complete delivery with signature OR photo proof
// ─────────────────────────────────────────────────────────────

function PodDialog({ job, onClose, onCompleted }: { job: MyJob; onClose: () => void; onCompleted: () => void }) {
  const [recipientName, setRecipientName] = useState(job.recipientName);
  const [hasSignature, setHasSignature] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tried, setTried] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const photoUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    },
    [],
  );

  const pickPhoto = (file: File | null) => {
    if (photoUrlRef.current) {
      URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = null;
    }
    setPhotoFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      photoUrlRef.current = url;
      setPhotoUrl(url);
    } else {
      setPhotoUrl(null);
    }
  };

  const nameMissing = tried && !recipientName.trim();
  const proofMissing = tried && !hasSignature && !photoFile;

  const submit = async () => {
    setTried(true);
    const name = recipientName.trim();
    if (!name) {
      toast.error("Enter the recipient's name to continue");
      return;
    }
    if (!hasSignature && !photoFile) {
      toast.error("Capture a signature or attach a photo before completing");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("recipientName", name);
      form.append("complete", "true");
      if (hasSignature && canvasRef.current) {
        const canvas = canvasRef.current;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("Could not read the signature — try again or attach a photo");
        form.append("file", new File([blob], `${job.trackingCode}-signature.png`, { type: "image/png" }));
        form.append("kind", "SIGNATURE");
      } else if (photoFile) {
        form.append("file", photoFile, photoFile.name);
        form.append("kind", "PHOTO");
      } else {
        throw new Error("No proof captured");
      }
      await api.post(`/api/deliveries/${job.id}/pod`, form);
      toast.success("Delivery completed — proof recorded");
      onCompleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record proof of delivery");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Complete delivery</DialogTitle>
          <DialogDescription>
            Record proof of delivery for <span className="font-mono font-medium text-foreground">{job.trackingCode}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pod-recipient">Recipient name *</Label>
            <Input
              id="pod-recipient"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Who received the package?"
              autoComplete="off"
              className="h-11"
              aria-invalid={nameMissing}
            />
            {nameMissing && <p className="text-xs text-rose-600 dark:text-rose-400">Recipient name is required.</p>}
          </div>

          <SignaturePad canvasRef={canvasRef} onInkChange={setHasSignature} />

          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pod-photo">Photo proof (optional alternative)</Label>
            <Input
              id="pod-photo"
              key={photoUrl ? "picked" : "empty"}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
              className="h-11"
            />
            {proofMissing && (
              <p className="text-xs text-rose-600 dark:text-rose-400">Add a signature or a photo to complete the delivery.</p>
            )}
            {photoUrl && photoFile ? (
              <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
                { }
                <img src={photoUrl} alt="Photo proof preview" className="size-20 shrink-0 rounded-md border object-cover" />
                <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                  <p className="w-full truncate text-xs font-medium">{photoFile.name}</p>
                  <p className="text-[11px] text-muted-foreground">{Math.max(1, Math.round(photoFile.size / 1024))} KB</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1 gap-1.5"
                    onClick={() => pickPhoto(null)}
                    disabled={submitting}
                  >
                    <X className="size-3.5" aria-hidden="true" /> Remove photo
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting} className="min-h-11">
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={submitting} className="min-h-11">
            {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
            {submitting ? "Recording…" : "Complete delivery"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Report problem dialog — mark a job FAILED with a reason
// ─────────────────────────────────────────────────────────────

function ReportProblemDialog({ job, onClose, onReported }: { job: MyJob; onClose: () => void; onReported: () => void }) {
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tried, setTried] = useState(false);

  const submit = async () => {
    setTried(true);
    if (!reason) {
      toast.error("Select what went wrong");
      return;
    }
    setSubmitting(true);
    try {
      const body: { status: "FAILED"; failureReason: string; note?: string } = {
        status: "FAILED",
        failureReason: reason,
      };
      if (note.trim()) body.note = note.trim();
      await api.post(`/api/deliveries/${job.id}/status`, body);
      toast.success("Problem reported — the dispatcher has been notified");
      onReported();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not report the problem");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>
            Mark <span className="font-mono font-medium text-foreground">{job.trackingCode}</span> as failed and alert your dispatcher.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>What went wrong? *</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-11 w-full" aria-label="Failure reason">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {FAILURE_REASONS.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tried && !reason && <p className="text-xs text-rose-600 dark:text-rose-400">Select a reason so dispatch knows what happened.</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="report-note">Internal note (optional)</Label>
            <Textarea
              id="report-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything dispatch should know — visible to your team only."
            />
          </div>

          <div
            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
            role="status"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>The dispatcher is notified immediately.</span>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting} className="min-h-11">
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={submit} disabled={submitting} className="min-h-11">
            {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <AlertTriangle className="size-4" aria-hidden="true" />}
            {submitting ? "Reporting…" : "Report problem"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Job detail dialog — opened via focusDeliveryId (notifications etc.)
// ─────────────────────────────────────────────────────────────

function eventDotColor(eventType: string): string {
  if (eventType === "DELIVERED") return "bg-emerald-500";
  if (eventType === "FAILED") return "bg-rose-500";
  return "bg-zinc-300 dark:bg-zinc-600";
}

function JobDetailDialog() {
  const focusDeliveryId = useAppStore((s) => s.focusDeliveryId);
  const focusDelivery = useAppStore((s) => s.focusDelivery);
  const { data, loading, error, reload } = useApiData<DeliveryDetail>(
    focusDeliveryId ? `/api/deliveries/${focusDeliveryId}` : null,
  );
  const detail = data && data.delivery.id === focusDeliveryId ? data : null;
  const job = detail?.delivery;

  return (
    <Dialog open={!!focusDeliveryId} onOpenChange={(open) => { if (!open) focusDelivery(null); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <span className="font-mono">{job?.trackingCode ?? "Job details"}</span>
            {job ? (
              <>
                <PriorityBadge priority={job.priority} />
                <StatusBadge status={job.status} />
              </>
            ) : null}
          </DialogTitle>
          <DialogDescription>Full job record — route, timeline and proof of delivery.</DialogDescription>
        </DialogHeader>

        {loading && !detail ? (
          <div className="flex flex-col gap-4" aria-busy="true">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-36 w-full" />
          </div>
        ) : error && !detail ? (
          <Card className="flex flex-col items-center gap-3 p-6 text-center">
            <AlertTriangle className="size-8 text-amber-500" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button type="button" variant="outline" className="min-h-11" onClick={reload}>
              <RefreshCw className="size-4" aria-hidden="true" /> Try again
            </Button>
          </Card>
        ) : detail && job ? (
          <div className="flex flex-col gap-5">
            <RouteBlock job={job} />
            <MetaBlock
              job={job}
              registration={job.assignment?.vehicleRegistration ?? null}
              vehicleType={job.assignment?.vehicleType ?? null}
            />

            <div>
              <h3 className="mb-3 text-sm font-semibold">Timeline</h3>
              {detail.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events recorded yet.</p>
              ) : (
                <ol className="max-h-72 overflow-y-auto pr-2 [scrollbar-width:thin]">
                  {detail.events
                    .slice()
                    .reverse()
                    .map((ev) => (
                      <li key={ev.id} className="relative border-l pb-4 pl-5 last:border-transparent last:pb-0">
                        <span
                          className={cn("absolute -left-[5px] top-1 size-2.5 rounded-full ring-4 ring-background", eventDotColor(ev.eventType))}
                          aria-hidden="true"
                        />
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm font-medium">{EVENT_TYPE_LABELS[ev.eventType] ?? ev.eventType}</span>
                          <span className="text-xs text-muted-foreground">{formatDateTime(ev.createdAt)}</span>
                        </div>
                        {ev.note ? <p className="mt-0.5 break-words text-sm text-muted-foreground">{ev.note}</p> : null}
                        {ev.actorName ? <p className="mt-0.5 text-xs text-muted-foreground/70">by {ev.actorName}</p> : null}
                      </li>
                    ))}
                </ol>
              )}
            </div>

            {detail.pods.length > 0 ? (
              <div>
                <h3 className="mb-3 text-sm font-semibold">Proof of delivery</h3>
                <div className="flex flex-wrap gap-3">
                  {detail.pods.map((pod) => (
                    <figure key={pod.id} className="w-28">
                      { }
                      <img
                        src={`/api/pod/${pod.id}`}
                        alt={`${pod.kind === "PHOTO" ? "Photo" : "Signature"} proof for ${job.trackingCode}`}
                        className="h-20 w-28 rounded-md border object-cover"
                      />
                      <figcaption className="mt-1 text-[11px] leading-snug text-muted-foreground">
                        {pod.kind === "PHOTO" ? "Photo" : "Signature"} · {formatDateTime(pod.capturedAt)}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Active job card
// ─────────────────────────────────────────────────────────────

function ActiveJobCard({
  job,
  busy,
  onTransition,
  onOpenPod,
  onOpenReport,
}: {
  job: MyJob;
  busy: boolean;
  onTransition: (job: MyJob, status: "PICKED_UP" | "IN_TRANSIT") => void;
  onOpenPod: (job: MyJob) => void;
  onOpenReport: (job: MyJob) => void;
}) {
  const registration = job.vehicle?.registrationNumber ?? job.assignment?.vehicleRegistration ?? null;
  const vehicleType = job.vehicle?.type ?? job.assignment?.vehicleType ?? null;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{job.trackingCode}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <PriorityBadge priority={job.priority} />
          <StatusBadge status={job.status} />
        </span>
      </div>

      <div className="mt-4">
        <RouteBlock job={job} />
      </div>

      <div className="mt-4">
        <MetaBlock job={job} registration={registration} vehicleType={vehicleType} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {job.status === "ASSIGNED" ? (
          <Button className="min-h-11" disabled={busy} onClick={() => onTransition(job, "PICKED_UP")}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <PackageCheck className="size-4" aria-hidden="true" />}
            Confirm pickup
          </Button>
        ) : null}
        {job.status === "PICKED_UP" ? (
          <Button className="min-h-11" disabled={busy} onClick={() => onTransition(job, "IN_TRANSIT")}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Truck className="size-4" aria-hidden="true" />}
            Start delivery
          </Button>
        ) : null}
        {job.status === "IN_TRANSIT" ? (
          <Button className="min-h-11" onClick={() => onOpenPod(job)}>
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Complete delivery
          </Button>
        ) : null}
        <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => onOpenReport(job)}>
          <AlertTriangle className="size-4" aria-hidden="true" />
          Report problem
        </Button>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// History card (compact)
// ─────────────────────────────────────────────────────────────

function HistoryCard({ job }: { job: MyJob }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{job.trackingCode}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <PriorityBadge priority={job.priority} />
          <StatusBadge status={job.status} />
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
        <span className="font-medium">{job.recipientName}</span>
        {job.status === "DELIVERED" && job.completedAt ? (
          <span className="text-muted-foreground">Completed {formatDateTime(job.completedAt)}</span>
        ) : null}
        {job.status === "FAILED" ? (
          <span className="text-rose-600 dark:text-rose-400">{failureReasonLabel(job.failureReason)}</span>
        ) : null}
        {job.status === "CANCELLED" ? <span className="text-muted-foreground">Cancelled</span> : null}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Driver portal view
// ─────────────────────────────────────────────────────────────

function DriverPortalView() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const [tab, setTab] = useState<"active" | "history">(view === "driver-history" ? "history" : "active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [podJob, setPodJob] = useState<MyJob | null>(null);
  const [reportJob, setReportJob] = useState<MyJob | null>(null);

  const active = useApiData<{ items: MyJob[] }>("/api/my/jobs");
  const history = useApiData<{ items: MyJob[] }>(tab === "history" ? "/api/my/jobs?scope=history" : null);

  // Keep the tab in sync when navigation happens elsewhere (bottom nav, notifications).
  useEffect(() => {
    if (view === "driver-jobs") setTab((t) => (t === "active" ? t : "active"));
    else if (view === "driver-history") setTab((t) => (t === "history" ? t : "history"));
  }, [view]);

  const handleTabChange = (value: string) => {
    const next: "active" | "history" = value === "history" ? "history" : "active";
    setTab(next);
    setView(next === "active" ? "driver-jobs" : "driver-history");
  };

  const transition = async (job: MyJob, status: "PICKED_UP" | "IN_TRANSIT") => {
    setBusyId(job.id);
    try {
      await api.post(`/api/deliveries/${job.id}/status`, { status });
      toast.success(status === "PICKED_UP" ? "Pickup confirmed — package is with you" : "Delivery started — you are on the way");
      useAppStore.getState().bump();
      active.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the job");
    } finally {
      setBusyId(null);
    }
  };

  const activeItems = active.data?.items ?? [];
  const historyItems = history.data?.items ?? [];
  const completedCount = historyItems.filter((j) => j.status === "DELIVERED").length;
  const failedCount = historyItems.filter((j) => j.status === "FAILED").length;
  const onTimeCount = historyItems.filter(
    (j) => j.status === "DELIVERED" && (!j.expectedAt || (j.completedAt && new Date(j.completedAt).getTime() <= new Date(j.expectedAt).getTime())),
  ).length;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="h-12 w-full">
          <TabsTrigger value="active" className="gap-1.5 text-sm">
            <PackageCheck className="size-4" aria-hidden="true" /> Active jobs
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5 text-sm">
            <History className="size-4" aria-hidden="true" /> History
          </TabsTrigger>
        </TabsList>

        {/* ── Active jobs ── */}
        <TabsContent value="active" className="mt-4">
          {active.loading && !active.data ? (
            <JobListSkeleton />
          ) : active.error && !active.data ? (
            <Card className="flex flex-col items-center gap-3 p-8 text-center">
              <AlertTriangle className="size-8 text-amber-500" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">{active.error}</p>
              <Button variant="outline" className="min-h-11" onClick={active.reload}>
                <RefreshCw className="size-4" aria-hidden="true" /> Try again
              </Button>
            </Card>
          ) : activeItems.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 p-10 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
                <PackageCheck className="size-7 text-primary" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium">No active jobs right now</p>
                <p className="mt-1 text-sm text-muted-foreground">Check back after dispatch assigns you a delivery.</p>
              </div>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              {activeItems.map((job) => (
                <ActiveJobCard
                  key={job.id}
                  job={job}
                  busy={busyId === job.id}
                  onTransition={transition}
                  onOpenPod={setPodJob}
                  onOpenReport={setReportJob}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── History ── */}
        <TabsContent value="history" className="mt-4">
          {history.loading && !history.data ? (
            <JobListSkeleton />
          ) : history.error && !history.data ? (
            <Card className="flex flex-col items-center gap-3 p-8 text-center">
              <AlertTriangle className="size-8 text-amber-500" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">{history.error}</p>
              <Button variant="outline" className="min-h-11" onClick={history.reload}>
                <RefreshCw className="size-4" aria-hidden="true" /> Try again
              </Button>
            </Card>
          ) : historyItems.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 p-10 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-muted">
                <History className="size-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium">No completed jobs yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Finished and failed deliveries will appear here.</p>
              </div>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex min-h-8 items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {completedCount} completed
                </span>
                <span className="inline-flex min-h-8 items-center rounded-full border border-rose-200 bg-rose-50 px-3 text-xs font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                  {failedCount} failed
                </span>
                <span className="inline-flex min-h-8 items-center rounded-full border bg-card px-3 text-xs font-medium text-muted-foreground">
                  {onTimeCount} on-time
                </span>
              </div>
              <div className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto pr-1 [scrollbar-width:thin]">
                {historyItems.map((job) => (
                  <HistoryCard key={job.id} job={job} />
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {podJob ? (
        <PodDialog
          job={podJob}
          onClose={() => setPodJob(null)}
          onCompleted={() => {
            useAppStore.getState().bump();
            active.reload();
            setPodJob(null);
          }}
        />
      ) : null}

      {reportJob ? (
        <ReportProblemDialog
          job={reportJob}
          onClose={() => setReportJob(null)}
          onReported={() => {
            useAppStore.getState().bump();
            active.reload();
            setReportJob(null);
          }}
        />
      ) : null}

      <JobDetailDialog />
    </div>
  );
}

export default DriverPortalView;
export { DriverPortalView };
