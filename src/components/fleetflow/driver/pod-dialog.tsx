"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import type { MyJob } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "./signature-pad";
import { PRESS } from "./job-utils";
import { SheetBody, SheetDialogContent, SheetFooter, SheetHeader } from "./ui";

/** Upload cap — matches the server (MAX_POD_FILE_BYTES in src/lib/storage.ts). */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** Raw camera photos above this are refused before we even try to shrink them. */
const MAX_PICKED_BYTES = 30 * 1024 * 1024;
/** Photos are downscaled so the long side is at most this many pixels. */
const MAX_PHOTO_EDGE = 1600;
const MAX_RECIPIENT_NAME = 120;

/**
 * Downscale and re-encode a photo as JPEG so it uploads quickly on mobile data
 * and fits the server cap. Returns the original if it can't be decoded or
 * shrinking wouldn't help.
 */
async function shrinkPhoto(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff"; // transparent PNGs → white, not black, as JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

/** Flatten the (transparent) signature canvas onto white and encode it as PNG. */
function signatureBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return new Promise((resolve) => flat.toBlob(resolve, "image/png"));
}

/** Complete delivery with a signature and/or photo proof. */
export function PodDialog({
  job,
  onClose,
  onCompleted,
  onFailed,
}: {
  job: MyJob;
  onClose: () => void;
  onCompleted: () => void;
  onFailed: () => void;
}) {
  const [recipientName, setRecipientName] = useState(job.recipientName);
  const [hasSignature, setHasSignature] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tried, setTried] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const photoUrlRef = useRef<string | null>(null);
  /** The photo already uploaded (without completing) — skipped when retrying. */
  const uploadedPhotoRef = useRef<File | null>(null);

  useEffect(
    () => () => {
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    },
    [],
  );

  const [preparing, setPreparing] = useState(false);
  const busy = submitting || preparing;

  const pickPhoto = async (picked: File | null) => {
    let file = picked;
    if (file && file.size > MAX_PICKED_BYTES) {
      toast.error("That photo is too large — retake it or pick a smaller image");
      file = null;
    }
    if (file) {
      setPreparing(true);
      file = await shrinkPhoto(file).finally(() => setPreparing(false));
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error("That photo is too large (max 4 MB) — retake it or pick a smaller image");
        file = null;
      }
    }
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
    if (name.length > MAX_RECIPIENT_NAME) {
      toast.error(`Recipient name must be ${MAX_RECIPIENT_NAME} characters or fewer`);
      return;
    }
    const upload = (file: File, kind: "SIGNATURE" | "PHOTO", complete: boolean) => {
      const form = new FormData();
      form.append("recipientName", name);
      form.append("complete", complete ? "true" : "false");
      form.append("file", file, file.name);
      form.append("kind", kind);
      return api.post(`/api/deliveries/${job.id}/pod`, form);
    };
    setSubmitting(true);
    try {
      const canvas = hasSignature ? canvasRef.current : null;
      if (canvas) {
        // Photo first (without completing), then the signature completes the delivery.
        if (photoFile && uploadedPhotoRef.current !== photoFile) {
          await upload(photoFile, "PHOTO", false);
          uploadedPhotoRef.current = photoFile;
        }
        const blob = await signatureBlob(canvas);
        if (!blob) throw new Error("Could not read the signature — try again or attach a photo");
        await upload(new File([blob], `${job.trackingCode}-signature.png`, { type: "image/png" }), "SIGNATURE", true);
      } else if (photoFile) {
        await upload(photoFile, "PHOTO", true);
      } else {
        throw new Error("No proof captured");
      }
      toast.success("Delivery completed — proof recorded");
      onCompleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record proof of delivery");
      onFailed();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <SheetDialogContent className="sm:max-w-md" closeDisabled={submitting}>
        <SheetHeader
          title="Complete delivery"
          description={
            <>
              Record proof of delivery for{" "}
              <span className="font-mono text-xs font-medium tracking-wider text-foreground">{job.trackingCode}</span>.
            </>
          }
        />

        <SheetBody className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pod-recipient" className="text-sm font-medium">
              Recipient name *
            </Label>
            <Input
              id="pod-recipient"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Who received the package?"
              autoComplete="off"
              maxLength={MAX_RECIPIENT_NAME}
              className="h-12 rounded-xl text-base"
              aria-invalid={nameMissing}
            />
            {nameMissing && <p className="text-sm text-rose-700 dark:text-rose-400">Recipient name is required.</p>}
          </div>

          <SignaturePad canvasRef={canvasRef} onInkChange={setHasSignature} invalid={proofMissing} />

          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">and / or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pod-photo" className="text-sm font-medium">
              Photo proof
            </Label>
            {photoUrl && photoFile ? (
              <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/40 p-3 dark:border-white/10">
                { }
                <img src={photoUrl} alt="Photo proof preview" className="size-20 shrink-0 rounded-lg border object-cover" />
                <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                  <p className="w-full truncate text-sm font-medium">{photoFile.name}</p>
                  <p className="text-sm tabular-nums text-muted-foreground">{Math.max(1, Math.round(photoFile.size / 1024))} KB</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-1 h-11 gap-1.5 rounded-xl"
                    onClick={() => pickPhoto(null)}
                    disabled={submitting}
                  >
                    <X className="size-4" aria-hidden="true" /> Remove photo
                  </Button>
                </div>
              </div>
            ) : null}
            <div
              className={cn(
                "relative rounded-xl has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                photoUrl && photoFile && "hidden",
              )}
            >
              <input
                id="pod-photo"
                key={photoUrl ? "picked" : "empty"}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                capture="environment"
                onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
                aria-describedby={proofMissing ? "pod-proof-error" : undefined}
              />
              <div
                className={cn(
                  "pointer-events-none flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-[15px] font-medium",
                  proofMissing ? "border-rose-400 text-rose-700 dark:text-rose-300" : "border-zinc-300 text-foreground dark:border-zinc-600",
                )}
                aria-hidden="true"
              >
                <Camera className="size-5 text-primary" />
                Take or choose a photo
              </div>
            </div>
            {proofMissing && (
              <p id="pod-proof-error" className="text-sm text-rose-700 dark:text-rose-400">
                Add a signature or a photo to complete the delivery.
              </p>
            )}
          </div>
        </SheetBody>

        <SheetFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting} className="h-12 rounded-xl sm:h-11">
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={busy} className={cn("h-12 rounded-xl text-[15px] font-semibold sm:h-11", PRESS)}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
            {submitting ? "Recording…" : preparing ? "Preparing photo…" : "Complete delivery"}
          </Button>
        </SheetFooter>
      </SheetDialogContent>
    </Dialog>
  );
}
