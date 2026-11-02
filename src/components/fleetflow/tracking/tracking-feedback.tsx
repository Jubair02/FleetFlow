"use client";

import { useId, useState } from "react";
import { CalendarCheck, CalendarClock, CalendarX, LoaderCircle, Megaphone, PhoneCall, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrackingData } from "@/lib/tracking";
import { Button } from "@/components/ui/button";
import { wallTimeToInstant } from "@/lib/zoned";
import type { TrackingFormat } from "./tracking-model";
import { ENTER, Surface, accentButton, accentText } from "./tracking-ui";

// ─────────────────────────────────────────────────────────────
// What the customer can do on the tracking page: read the company's
// message, rate a delivered parcel, ask for another delivery day.
// Rules: src/lib/customer-feedback.ts (the server re-checks everything).
// Deliberately light: no form library, no zod — the public bundle stays small.
// ─────────────────────────────────────────────────────────────

const RATING_COMMENT_MAX = 500;
const RESCHEDULE_NOTE_MAX = 300;
const WINDOWS = ["ANY", "MORNING", "AFTERNOON", "EVENING"] as const;
const RESCHEDULABLE = ["CREATED", "ASSIGNED", "FAILED"];

type SendResult = { ok: true } | { ok: false; message: string };

/** POST to a tracking feedback route; errors come back translated by their `code`. */
async function send(token: string, action: "rating" | "reschedule", body: unknown, f: TrackingFormat): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch(`/api/track/${encodeURIComponent(token)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: f.t.feedbackOffline };
  }
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => ({}))) as { code?: string };
  return { ok: false, message: (data.code && f.t.feedbackErrors[data.code]) || f.t.feedbackErrors.error };
}

function FieldMessage({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="text-sm text-rose-700 dark:text-rose-400">
      {children}
    </p>
  );
}

const TEXTAREA =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

// ── Company message ──────────────────────────────────────────

export function BrandMessage({ data, f }: { data: TrackingData; f: TrackingFormat }) {
  const message = data.branding?.message;
  if (!message) return null;
  return (
    <Surface aria-label={f.t.messageFrom(data.sender.name)} className={cn("flex gap-3 p-4 sm:p-5", ENTER)}>
      <Megaphone className={cn("mt-0.5 size-4 shrink-0", accentText(!!data.branding?.color))} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{f.t.messageFrom(data.sender.name)}</p>
        <p className="mt-0.5 text-sm leading-relaxed break-words whitespace-pre-line">{message}</p>
      </div>
    </Surface>
  );
}

// ── Rating ───────────────────────────────────────────────────

function StarsDisplay({ score, f }: { score: number; f: TrackingFormat }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={f.t.rateStar(f.number(score))}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn("size-5", n <= score ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} aria-hidden="true" />
      ))}
    </span>
  );
}

export function RatingCard({ token, data, f, onSent }: { token: string; data: TrackingData; f: TrackingFormat; onSent: () => void }) {
  const { rating } = data.feedback;
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const uid = useId();
  const branded = !!data.branding?.color;

  const given = sent ?? rating.score;
  if (given) {
    return (
      <Surface aria-labelledby={`${uid}-thanks`} className={cn("flex items-start gap-4 p-5 sm:p-6", ENTER)} role="status">
        <div className="min-w-0">
          <h2 id={`${uid}-thanks`} className="text-sm font-semibold">
            {f.t.rateThanksTitle}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StarsDisplay score={given} f={f} />
            <span className="text-sm text-muted-foreground">{f.t.rateYouGave(f.number(given))}</span>
          </div>
        </div>
      </Surface>
    );
  }
  if (!rating.canRate) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (score < 1) {
      setError(f.t.rateChooseStars);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await send(token, "rating", { rating: score, comment: comment.trim() || null }, f);
    setBusy(false);
    if (r.ok) {
      setSent(score);
      onSent();
    } else setError(r.message);
  };

  const shown = hover || score;
  const left = RATING_COMMENT_MAX - comment.length;

  return (
    <Surface aria-labelledby={`${uid}-title`} className={cn("p-5 sm:p-6", ENTER)}>
      <h2 id={`${uid}-title`} className="text-base font-semibold tracking-tight">
        {f.t.rateTitle}
      </h2>
      <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{f.t.rateBody(data.sender.name)}</p>
      <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-4">
        <fieldset aria-describedby={error ? `${uid}-error` : undefined}>
          <legend className="sr-only">{f.t.rateStarsLabel}</legend>
          <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <label
                key={n}
                onMouseEnter={() => setHover(n)}
                className="flex size-12 cursor-pointer items-center justify-center rounded-xl outline-none has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
              >
                <input
                  type="radio"
                  name={`${uid}-stars`}
                  value={n}
                  checked={score === n}
                  onChange={() => {
                    setScore(n);
                    setError(null);
                  }}
                  className="sr-only"
                />
                <span className="sr-only">{f.t.rateStar(f.number(n))}</span>
                <Star
                  className={cn(
                    "size-8 transition-transform duration-100 motion-safe:active:scale-90",
                    n <= shown ? "fill-amber-400 text-amber-400" : "text-muted-foreground/50",
                  )}
                  aria-hidden="true"
                />
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-comment`} className="text-sm font-medium">
            {f.t.rateCommentLabel}
          </label>
          <textarea
            id={`${uid}-comment`}
            rows={3}
            maxLength={RATING_COMMENT_MAX}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={f.t.rateCommentPlaceholder}
            className={TEXTAREA}
          />
          {left < 100 ? <p className="text-xs text-muted-foreground tabular-nums">{f.t.charsLeft(f.number(left))}</p> : null}
        </div>
        {error ? <FieldMessage id={`${uid}-error`}>{error}</FieldMessage> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="submit" disabled={busy} className={cn("h-12 rounded-xl px-5 text-[15px]", accentButton(branded))}>
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? f.t.sending : f.t.rateSubmit}
          </Button>
          {rating.closesAt ? (
            <p className="text-xs text-muted-foreground" suppressHydrationWarning>
              {f.t.rateClosesOn(f.fullDate(new Date(rating.closesAt)))}
            </p>
          ) : null}
        </div>
      </form>
    </Surface>
  );
}

// ── Reschedule ───────────────────────────────────────────────

/** "YYYY-MM-DD" keys from min to max inclusive (calendar arithmetic only). */
function dayKeys(min: string, max: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${max}T00:00:00.000Z`);
  for (let t = Date.parse(`${min}T00:00:00.000Z`); t <= end && out.length < 31; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function dayLabel(key: string, f: TrackingFormat, now: number): string {
  const d = wallTimeToInstant(`${key}T12:00`, f.timeZone) ?? new Date(`${key}T12:00:00Z`);
  const diff = f.dayDiff(d, new Date(now));
  if (diff === 1) return f.t.tomorrow.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  return f.weekdayDayMonth(d, !f.sameYear(d, new Date(now)));
}

function windowText(window: string | null, f: TrackingFormat): string {
  const w = window ?? "ANY";
  return (f.t.rescheduleWindows[w] ?? f.t.rescheduleWindows.ANY).toLowerCase();
}

function InfoCard({ icon, title, children, tone }: { icon: React.ReactNode; title: string; children: React.ReactNode; tone: "amber" | "neutral" }) {
  return (
    <Surface className={cn("flex items-start gap-3.5 p-5 sm:p-6", ENTER)} role="status">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
          tone === "amber"
            ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900/60"
            : "bg-muted text-muted-foreground ring-border/60 dark:bg-white/5 dark:ring-white/10",
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="mt-0.5 text-sm text-pretty text-muted-foreground">{children}</div>
      </div>
    </Surface>
  );
}

export function RescheduleCard({
  token,
  data,
  now,
  f,
  onSent,
}: {
  token: string;
  data: TrackingData;
  now: number;
  f: TrackingFormat;
  onSent: () => void;
}) {
  const r = data.feedback.reschedule;
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("");
  const [slot, setSlot] = useState<(typeof WINDOWS)[number]>("ANY");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const branded = !!data.branding?.color;
  const sender = data.sender.name;

  if (!RESCHEDULABLE.includes(data.status) && r.status !== "PENDING") return null;

  if (r.status === "PENDING") {
    const when = r.requestedFor
      ? f.t.rescheduleWhen(f.weekdayDayMonth(new Date(r.requestedFor), !f.sameYear(new Date(r.requestedFor), new Date(now))), windowText(r.window, f))
      : "";
    return (
      <InfoCard icon={<CalendarClock className="size-5" />} title={f.t.reschedulePendingTitle} tone="amber">
        <span suppressHydrationWarning>{f.t.reschedulePendingBody(when, sender)}</span>
      </InfoCard>
    );
  }

  const answer =
    r.status === "ACCEPTED" ? (
      <p className="flex items-start gap-2 text-sm">
        <CalendarCheck className={cn("mt-0.5 size-4 shrink-0", accentText(branded))} aria-hidden="true" />
        <span>{f.t.rescheduleAcceptedBody(sender)}</span>
      </p>
    ) : r.status === "DECLINED" ? (
      <p className="flex items-start gap-2 text-sm">
        <CalendarX className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
        <span>{f.t.rescheduleDeclinedBody(sender)}</span>
      </p>
    ) : null;

  if (!r.canRequest) {
    if (r.blockedBy === "limit") {
      return (
        <InfoCard icon={<PhoneCall className="size-5" />} title={f.t.rescheduleTitle} tone="neutral">
          {f.t.rescheduleLimitBody(sender)}
        </InfoCard>
      );
    }
    return answer ? <Surface className={cn("p-5 sm:p-6", ENTER)}>{answer}</Surface> : null;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!day) {
      setError(f.t.rescheduleChooseDay);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await send(token, "reschedule", { date: day, window: slot, note: note.trim() || null }, f);
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      onSent();
    } else setError(res.message);
  };

  const days = dayKeys(r.minDate, r.maxDate);
  const chip =
    "flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-xl border px-2 py-1.5 text-center text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50";
  const chipOn = branded
    ? "border-[var(--brand-solid)] bg-[var(--brand-solid)] text-white"
    : "border-emerald-700 bg-emerald-700 text-white";
  const chipOff = "border-border bg-background hover:bg-muted dark:bg-input/30";

  return (
    <Surface aria-labelledby={`${uid}-title`} className={cn("p-5 sm:p-6", ENTER)}>
      {answer ? <div className="mb-4 rounded-xl bg-muted/60 p-3 dark:bg-white/5">{answer}</div> : null}
      <h2 id={`${uid}-title`} className="text-base font-semibold tracking-tight">
        {f.t.rescheduleTitle}
      </h2>
      <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{f.t.rescheduleBody(sender)}</p>

      {!open ? (
        <Button type="button" variant="outline" className="mt-4 h-12 w-full rounded-xl text-[15px] sm:w-auto sm:px-5" onClick={() => setOpen(true)}>
          <CalendarClock className="size-4" aria-hidden="true" /> {f.t.rescheduleOpen}
        </Button>
      ) : (
        <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{f.t.rescheduleDayLabel}</legend>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {days.map((key) => (
                <label key={key} className={cn(chip, day === key ? chipOn : chipOff)}>
                  <input
                    type="radio"
                    name={`${uid}-day`}
                    value={key}
                    checked={day === key}
                    onChange={() => {
                      setDay(key);
                      setError(null);
                    }}
                    className="sr-only"
                  />
                  <span className="leading-tight font-medium" suppressHydrationWarning>
                    {dayLabel(key, f, now)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">{f.t.rescheduleWindowLabel}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {WINDOWS.map((w) => (
                <label key={w} className={cn(chip, slot === w ? chipOn : chipOff)}>
                  <input type="radio" name={`${uid}-window`} value={w} checked={slot === w} onChange={() => setSlot(w)} className="sr-only" />
                  <span className="font-medium">{f.t.rescheduleWindows[w]}</span>
                  <span className={cn("text-xs", slot === w ? "text-white/90" : "text-muted-foreground")}>{f.t.rescheduleWindowHints[w]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-note`} className="text-sm font-medium">
              {f.t.rescheduleNoteLabel}
            </label>
            <textarea
              id={`${uid}-note`}
              rows={2}
              maxLength={RESCHEDULE_NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={f.t.rescheduleNotePlaceholder}
              className={TEXTAREA}
            />
            {RESCHEDULE_NOTE_MAX - note.length < 60 ? (
              <p className="text-xs text-muted-foreground tabular-nums">{f.t.charsLeft(f.number(RESCHEDULE_NOTE_MAX - note.length))}</p>
            ) : null}
          </div>

          {error ? <FieldMessage id={`${uid}-error`}>{error}</FieldMessage> : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="ghost" className="h-12 rounded-xl" onClick={() => setOpen(false)} disabled={busy}>
              {f.t.rescheduleCancel}
            </Button>
            <Button type="submit" disabled={busy} className={cn("h-12 rounded-xl px-5 text-[15px]", accentButton(branded))}>
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
              {busy ? f.t.sending : f.t.rescheduleSubmit}
            </Button>
          </div>
        </form>
      )}
    </Surface>
  );
}
