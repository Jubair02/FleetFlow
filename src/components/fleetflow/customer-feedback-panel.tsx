"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, CalendarClock, CalendarX, LoaderCircle, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { displayTimezone, formatDateTime } from "@/lib/format";
import { ACCEPTABLE_STATUSES, RESCHEDULE_NOTE_MAX, dayKeyInTz, describeReschedule, isRescheduleWindow, windowDeadline } from "@/lib/customer-feedback";
import type { Delivery } from "@/lib/types";
import { instantToWallInput, wallTimeToInstant } from "@/lib/zoned";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";

// ─────────────────────────────────────────────────────────────
// Customer feedback in the delivery detail dialog: the recipient's rating
// and their reschedule request (accept / decline). docs/CUSTOMER-EXPERIENCE.md
// ─────────────────────────────────────────────────────────────

/** Small badge for the dialog title while a request waits. */
export function RescheduleBadge({ delivery }: { delivery: Pick<Delivery, "customer"> }) {
  if (delivery.customer?.reschedule?.status !== "PENDING") return null;
  return (
    <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
      <CalendarClock aria-hidden="true" /> Reschedule requested
    </Badge>
  );
}

function Stars({ score }: { score: number }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`${score} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn("size-4", n <= score ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} aria-hidden="true" />
      ))}
    </span>
  );
}

function RescheduleRequest({ delivery }: { delivery: Delivery }) {
  const req = delivery.customer!.reschedule!;
  const tz = displayTimezone();
  const window = isRescheduleWindow(req.window) ? req.window : "ANY";
  const when = req.requestedFor ? describeReschedule(req.requestedFor, window, tz) : "—";
  const defaultDeadline = req.requestedFor ? windowDeadline(dayKeyInTz(new Date(req.requestedFor), tz), window, tz) : null;

  const [expected, setExpected] = useState(() => (defaultDeadline ? instantToWallInput(defaultDeadline, tz) : ""));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);

  const canAccept = (ACCEPTABLE_STATUSES as readonly string[]).includes(delivery.status);

  async function resolve(action: "accept" | "decline") {
    let expectedAt: string | undefined;
    if (action === "accept" && expected) {
      const instant = wallTimeToInstant(expected, tz);
      if (!instant) {
        toast.error("Enter a valid delivery date and time");
        return;
      }
      expectedAt = instant.toISOString();
    }
    setBusy(action);
    try {
      const res = await api.post<{ reopened: boolean }>(`/api/deliveries/${delivery.id}/reschedule`, {
        action,
        expectedAt,
        note: message.trim() || null,
      });
      toast.success(
        action === "accept"
          ? res.reopened
            ? "Reschedule accepted — the delivery is back in the pending queue"
            : "Reschedule accepted — the customer has been told"
          : "Reschedule declined — the customer has been told"
      );
      useAppStore.getState().bump();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="reschedule-heading" className="rounded-lg border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-900/70 dark:bg-amber-950/30">
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id="reschedule-heading" className="text-sm font-semibold">
            Customer asked to reschedule
          </h3>
          <p className="mt-0.5 text-sm">{when}</p>
          {req.note ? <p className="mt-1.5 rounded-md bg-background/70 px-2.5 py-1.5 text-sm break-words italic dark:bg-white/5">“{req.note}”</p> : null}
          {req.requestedAt ? <p className="mt-1 text-xs text-muted-foreground">Asked {formatDateTime(req.requestedAt)}</p> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="reschedule-expected">New expected time</Label>
          <Input
            id="reschedule-expected"
            type="datetime-local"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            disabled={!canAccept}
            className="min-h-11 sm:min-h-9"
            aria-describedby="reschedule-expected-hint"
          />
          <p id="reschedule-expected-hint" className="text-xs text-muted-foreground">
            Defaults to the end of the window the customer chose{delivery.status === "FAILED" ? ". Accepting returns this failed delivery to the pending queue." : "."}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reschedule-message">Message to the customer (optional)</Label>
          <Textarea
            id="reschedule-message"
            rows={2}
            maxLength={RESCHEDULE_NOTE_MAX}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Shown on their tracking page"
          />
        </div>
      </div>
      {!canAccept ? (
        <p className="mt-2 text-xs text-muted-foreground">This delivery is already under way or finished — it can only be declined.</p>
      ) : null}
      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={!!busy} onClick={() => void resolve("decline")} className="min-h-11 sm:min-h-9">
          {busy === "decline" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <CalendarX aria-hidden="true" />} Decline
        </Button>
        <Button type="button" disabled={!!busy || !canAccept} onClick={() => void resolve("accept")} className="min-h-11 sm:min-h-9">
          {busy === "accept" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <CalendarCheck aria-hidden="true" />} Accept
        </Button>
      </div>
    </section>
  );
}

/** Rating + reschedule request; renders nothing when the customer hasn't done either. */
export function CustomerFeedbackPanel({ delivery }: { delivery: Delivery }) {
  const c = delivery.customer;
  if (!c || (!c.rating && !c.reschedule)) return null;
  const req = c.reschedule;
  return (
    <div className="space-y-3">
      {req?.status === "PENDING" ? <RescheduleRequest key={`${delivery.id}:${req.requestedAt}`} delivery={delivery} /> : null}
      {req && req.status !== "PENDING" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          {req.status === "ACCEPTED" ? <CalendarCheck className="size-4" aria-hidden="true" /> : <CalendarX className="size-4" aria-hidden="true" />}
          Customer reschedule request {req.status === "ACCEPTED" ? "accepted" : "declined"}
          {req.resolvedAt ? ` · ${formatDateTime(req.resolvedAt)}` : ""}
        </p>
      ) : null}
      {c.rating ? (
        <div className="rounded-lg border p-4">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Customer rating</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
            <Stars score={c.rating.score} />
            <span className="font-medium tabular-nums">{c.rating.score}/5</span>
            {c.rating.ratedAt ? <span className="text-xs text-muted-foreground">· {formatDateTime(c.rating.ratedAt)}</span> : null}
          </div>
          {c.rating.comment ? <p className="mt-2 text-sm break-words whitespace-pre-line text-muted-foreground">“{c.rating.comment}”</p> : null}
        </div>
      ) : null}
    </div>
  );
}
