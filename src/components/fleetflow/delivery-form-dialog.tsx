"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format, isValid } from "date-fns";
import { AlertTriangle, Loader2, Plus, Save } from "lucide-react";

import { api, useApiData } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import type { Delivery } from "@/lib/types";
import { PRIORITIES, PRIORITY_LABELS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Create / edit delivery dialog — mirrors createDeliverySchema
// (src/lib/validation.ts) so most errors are caught before the request.
// ─────────────────────────────────────────────────────────────

const LIMITS = {
  recipientName: { min: 2, max: 120 },
  recipientPhone: { min: 6, max: 30 },
  pickupAddress: { min: 5, max: 300 },
  deliveryAddress: { min: 5, max: 300 },
  instructions: { max: 500 },
  externalRef: { max: 64 },
  recipientEmail: { max: 254 },
} as const;

// Same shape check as zod's .email() in practice; the server re-validates.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface OrgResponse {
  organization: { defaultPickupAddress: string | null };
}

interface FormState {
  recipientName: string;
  recipientPhone: string;
  pickupAddress: string;
  deliveryAddress: string;
  instructions: string;
  externalRef: string;
  recipientEmail: string;
  priority: string;
  expectedAtLocal: string;
}

type FieldKey = keyof FormState;
type FormErrors = Partial<Record<FieldKey, string>>;

const EMPTY_FORM: FormState = {
  recipientName: "",
  recipientPhone: "",
  pickupAddress: "",
  deliveryAddress: "",
  instructions: "",
  externalRef: "",
  recipientEmail: "",
  priority: "NORMAL",
  expectedAtLocal: "",
};

/** Date → value for <input type="datetime-local"> (local time, minute precision). */
function toLocalInput(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

function formFromDelivery(d: Delivery): FormState {
  const expected = d.expectedAt ? new Date(d.expectedAt) : null;
  return {
    recipientName: d.recipientName,
    recipientPhone: d.recipientPhone,
    pickupAddress: d.pickupAddress,
    deliveryAddress: d.deliveryAddress,
    instructions: d.instructions ?? "",
    externalRef: d.externalRef ?? "",
    recipientEmail: d.recipientEmail ?? "",
    priority: d.priority,
    expectedAtLocal: expected && isValid(expected) ? toLocalInput(expected) : "",
  };
}

function lengthError(label: string, value: string, min: number, max: number): string | undefined {
  const len = value.trim().length;
  if (len === 0) return `${label} is required.`;
  if (len < min) return `${label} must be at least ${min} characters.`;
  if (len > max) return `${label} must be at most ${max} characters.`;
  return undefined;
}

function validate(form: FormState, checkExpected: boolean): FormErrors {
  const errs: FormErrors = {
    recipientName: lengthError("Recipient name", form.recipientName, LIMITS.recipientName.min, LIMITS.recipientName.max),
    recipientPhone: lengthError("Contact number", form.recipientPhone, LIMITS.recipientPhone.min, LIMITS.recipientPhone.max),
    pickupAddress: lengthError("Pickup address", form.pickupAddress, LIMITS.pickupAddress.min, LIMITS.pickupAddress.max),
    deliveryAddress: lengthError(
      "Delivery address",
      form.deliveryAddress,
      LIMITS.deliveryAddress.min,
      LIMITS.deliveryAddress.max,
    ),
  };
  if (form.instructions.trim().length > LIMITS.instructions.max) {
    errs.instructions = `Instructions must be at most ${LIMITS.instructions.max} characters.`;
  }
  if (form.externalRef.trim().length > LIMITS.externalRef.max) {
    errs.externalRef = `Order reference must be at most ${LIMITS.externalRef.max} characters.`;
  }
  const email = form.recipientEmail.trim();
  if (email && (email.length > LIMITS.recipientEmail.max || !EMAIL_RE.test(email))) {
    errs.recipientEmail = "Enter a valid customer email.";
  }
  if (checkExpected && form.expectedAtLocal) {
    const d = new Date(form.expectedAtLocal);
    if (!isValid(d)) errs.expectedAtLocal = "Enter a valid date and time.";
    else if (d.getTime() < Date.now()) errs.expectedAtLocal = "Expected delivery must be in the future.";
  }
  for (const k of Object.keys(errs) as FieldKey[]) if (!errs[k]) delete errs[k];
  return errs;
}

function expectedIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return isValid(d) ? d.toISOString() : null;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="text-xs text-destructive">
      {message}
    </p>
  ) : null;
}

// ── Public component ─────────────────────────────────────────

export function DeliveryFormDialog({
  open,
  onOpenChange,
  delivery,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** When set, the dialog edits this delivery; otherwise it creates a new one. */
  delivery?: Delivery | null;
}) {
  const [submitting, setSubmitting] = useState(false);
  const editing = !!delivery;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (submitting && !o) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{delivery ? `Edit ${delivery.trackingCode}` : "New delivery"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update recipient, addresses, priority or deadline. Only changed fields are saved."
              : "Create a delivery order — it enters the dispatch queue for assignment."}
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every opening starts from a fresh form. */}
        <DeliveryForm
          delivery={delivery ?? null}
          submitting={submitting}
          setSubmitting={setSubmitting}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

// ── Form body ────────────────────────────────────────────────

function DeliveryForm({
  delivery,
  submitting,
  setSubmitting,
  onDone,
}: {
  delivery: Delivery | null;
  submitting: boolean;
  setSubmitting: (b: boolean) => void;
  onDone: () => void;
}) {
  const editing = !!delivery;
  const [initial] = useState<FormState>(() => (delivery ? formFromDelivery(delivery) : EMPTY_FORM));
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [minExpected] = useState(() => toLocalInput(new Date()));

  // New deliveries: prefill the pickup address from the organization default
  // once it loads, unless the user already typed one.
  const { data: orgData } = useApiData<OrgResponse>(editing ? null : "/api/org");
  const defaultPickup = orgData?.organization.defaultPickupAddress?.trim() || "";
  const [pickupPrefillDone, setPickupPrefillDone] = useState(false);
  const [pickupFromDefault, setPickupFromDefault] = useState(false);
  if (!editing && !pickupPrefillDone && defaultPickup) {
    setPickupPrefillDone(true);
    if (!form.pickupAddress.trim()) {
      setForm((f) => ({ ...f, pickupAddress: defaultPickup }));
      setPickupFromDefault(true);
    }
  }

  const idPrefix = editing ? "edit" : "new";

  function setField(key: FieldKey, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setServerError(null);
    if (errors[key]) {
      setErrors((er) => {
        const next = { ...er };
        delete next[key];
        return next;
      });
    }
  }

  /** Edit mode: only the fields that differ from the loaded delivery. */
  function changedFields(): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    const textKeys = [
      "recipientName",
      "recipientPhone",
      "pickupAddress",
      "deliveryAddress",
      "instructions",
      "externalRef",
      "recipientEmail",
    ] as const;
    for (const k of textKeys) {
      if (form[k].trim() !== initial[k].trim()) body[k] = form[k].trim();
    }
    if (form.priority !== initial.priority) body.priority = form.priority;
    if (form.expectedAtLocal !== initial.expectedAtLocal) body.expectedAt = expectedIso(form.expectedAtLocal);
    return body;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    // An unchanged (possibly past) deadline on an existing delivery is left alone.
    const checkExpected = !editing || form.expectedAtLocal !== initial.expectedAtLocal;
    const errs = validate(form, checkExpected);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    if (delivery) {
      const body = changedFields();
      if (Object.keys(body).length === 0) {
        toast.info("No changes to save");
        onDone();
        return;
      }
      setSubmitting(true);
      try {
        await api.patch(`/api/deliveries/${delivery.id}`, body);
        toast.success(`Delivery ${delivery.trackingCode} updated`);
        onDone();
        useAppStore.getState().bump();
      } catch (err) {
        setServerError(err instanceof Error ? err.message : "Failed to update delivery");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post<{ delivery: Delivery }>("/api/deliveries", {
        recipientName: form.recipientName.trim(),
        recipientPhone: form.recipientPhone.trim(),
        pickupAddress: form.pickupAddress.trim(),
        deliveryAddress: form.deliveryAddress.trim(),
        instructions: form.instructions.trim() || undefined,
        externalRef: form.externalRef.trim() || undefined,
        recipientEmail: form.recipientEmail.trim() || undefined,
        priority: form.priority,
        expectedAt: expectedIso(form.expectedAtLocal),
      });
      toast.success(`Delivery created — tracking code ${res.delivery.trackingCode}`);
      onDone();
      useAppStore.getState().bump();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Failed to create delivery");
    } finally {
      setSubmitting(false);
    }
  }

  const errorClass = "border-destructive focus-visible:ring-destructive/30";

  const describedBy = (field: FieldKey) => (errors[field] ? `${idPrefix}-${field}-error` : undefined);

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-recipient-name`}>
            Recipient name <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`${idPrefix}-recipient-name`}
            value={form.recipientName}
            onChange={(e) => setField("recipientName", e.target.value)}
            maxLength={LIMITS.recipientName.max}
            aria-invalid={!!errors.recipientName}
            aria-describedby={describedBy("recipientName")}
            placeholder="Jane Doe"
            autoComplete="off"
            className={cn("min-h-11 sm:min-h-9", errors.recipientName && errorClass)}
          />
          <FieldError id={`${idPrefix}-recipientName-error`} message={errors.recipientName} />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-recipient-phone`}>
            Contact number <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`${idPrefix}-recipient-phone`}
            type="tel"
            value={form.recipientPhone}
            onChange={(e) => setField("recipientPhone", e.target.value)}
            maxLength={LIMITS.recipientPhone.max}
            aria-invalid={!!errors.recipientPhone}
            aria-describedby={describedBy("recipientPhone")}
            placeholder="+1 555 010 1234"
            autoComplete="off"
            className={cn("min-h-11 sm:min-h-9", errors.recipientPhone && errorClass)}
          />
          <FieldError id={`${idPrefix}-recipientPhone-error`} message={errors.recipientPhone} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-pickup`}>
          Pickup address <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id={`${idPrefix}-pickup`}
          value={form.pickupAddress}
          onChange={(e) => {
            setField("pickupAddress", e.target.value);
            setPickupFromDefault(false);
          }}
          maxLength={LIMITS.pickupAddress.max}
          aria-invalid={!!errors.pickupAddress}
          aria-describedby={describedBy("pickupAddress")}
          placeholder="Warehouse 4, 12 Harbor Industrial Park"
          className={cn("min-h-11 sm:min-h-9", errors.pickupAddress && errorClass)}
        />
        {pickupFromDefault && !errors.pickupAddress ? (
          <p className="text-xs text-muted-foreground">Prefilled with your default pickup address — edit if this order ships from elsewhere.</p>
        ) : null}
        <FieldError id={`${idPrefix}-pickupAddress-error`} message={errors.pickupAddress} />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-delivery-address`}>
          Delivery address <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id={`${idPrefix}-delivery-address`}
          value={form.deliveryAddress}
          onChange={(e) => setField("deliveryAddress", e.target.value)}
          maxLength={LIMITS.deliveryAddress.max}
          aria-invalid={!!errors.deliveryAddress}
          aria-describedby={describedBy("deliveryAddress")}
          placeholder="88 Maple Street, Apt 3B, Springfield"
          className={cn(errors.deliveryAddress && errorClass)}
        />
        <FieldError id={`${idPrefix}-deliveryAddress-error`} message={errors.deliveryAddress} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-external-ref`}>Order reference (optional)</Label>
          <Input
            id={`${idPrefix}-external-ref`}
            value={form.externalRef}
            onChange={(e) => setField("externalRef", e.target.value)}
            maxLength={LIMITS.externalRef.max}
            aria-invalid={!!errors.externalRef}
            aria-describedby={describedBy("externalRef")}
            placeholder="INV-10231"
            autoComplete="off"
            className={cn("min-h-11 sm:min-h-9", errors.externalRef && errorClass)}
          />
          <FieldError id={`${idPrefix}-externalRef-error`} message={errors.externalRef} />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-recipient-email`}>Customer email (gets the tracking link)</Label>
          <Input
            id={`${idPrefix}-recipient-email`}
            type="email"
            inputMode="email"
            value={form.recipientEmail}
            onChange={(e) => setField("recipientEmail", e.target.value)}
            maxLength={LIMITS.recipientEmail.max}
            aria-invalid={!!errors.recipientEmail}
            aria-describedby={describedBy("recipientEmail")}
            placeholder="customer@example.com"
            autoComplete="off"
            className={cn("min-h-11 sm:min-h-9", errors.recipientEmail && errorClass)}
          />
          <FieldError id={`${idPrefix}-recipientEmail-error`} message={errors.recipientEmail} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={`${idPrefix}-instructions`}>Delivery instructions (optional)</Label>
          <span className="text-xs tabular-nums text-muted-foreground" aria-hidden>
            {form.instructions.length}/{LIMITS.instructions.max}
          </span>
        </div>
        <Textarea
          id={`${idPrefix}-instructions`}
          value={form.instructions}
          onChange={(e) => setField("instructions", e.target.value)}
          maxLength={LIMITS.instructions.max}
          aria-invalid={!!errors.instructions}
          aria-describedby={describedBy("instructions")}
          placeholder="Leave at the front desk, call on arrival…"
          className={cn(errors.instructions && errorClass)}
        />
        <FieldError id={`${idPrefix}-instructions-error`} message={errors.instructions} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-priority`}>Priority</Label>
          <Select value={form.priority} onValueChange={(v) => setField("priority", v)}>
            <SelectTrigger id={`${idPrefix}-priority`} className="min-h-11 w-full sm:min-h-9">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-expected`}>Expected delivery (optional)</Label>
          <Input
            id={`${idPrefix}-expected`}
            type="datetime-local"
            value={form.expectedAtLocal}
            min={minExpected}
            onChange={(e) => setField("expectedAtLocal", e.target.value)}
            aria-invalid={!!errors.expectedAtLocal}
            aria-describedby={describedBy("expectedAtLocal")}
            className={cn("min-h-11 sm:min-h-9", errors.expectedAtLocal && errorClass)}
          />
          <FieldError id={`${idPrefix}-expectedAtLocal-error`} message={errors.expectedAtLocal} />
        </div>
      </div>

      {serverError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{serverError}</span>
        </div>
      ) : null}

      <DialogFooter className="gap-2 pt-2">
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={submitting} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" className="min-h-11 sm:min-h-9" disabled={submitting}>
          {submitting ? <Loader2 className="animate-spin" /> : editing ? <Save /> : <Plus />}
          {editing ? "Save changes" : "Create delivery"}
        </Button>
      </DialogFooter>
    </form>
  );
}
