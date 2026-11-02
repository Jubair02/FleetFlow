"use client";

import { useState } from "react";
import { ArrowUpRight, Banknote, CalendarDays, ChevronDown, MapPin, Phone, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrackingData } from "@/lib/tracking";
import { Button } from "@/components/ui/button";
import { codPaid, eventLabel, eventTime, mapsUrl, telHref, type TrackingFormat } from "./tracking-model";
import { ENTER, Surface, accentButton, accentText } from "./tracking-ui";

// ─────────────────────────────────────────────────────────────
// Details: recipient, address (+ maps), call the sender
// ─────────────────────────────────────────────────────────────

function DetailRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground dark:bg-white/5"
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 text-sm break-words">{children}</dd>
      </div>
    </div>
  );
}

export function TrackingDetails({ data, f }: { data: TrackingData; f: TrackingFormat }) {
  const { sender } = data;
  const branded = !!data.branding?.color;
  return (
    <Surface aria-labelledby="tracking-details" className={cn("p-5 sm:p-6", ENTER)}>
      <h2 id="tracking-details" className="text-sm font-semibold">
        {f.t.detailsHeading}
      </h2>
      <dl className="mt-4 flex flex-col gap-4">
        <DetailRow icon={<User className="size-4" />} label={f.t.recipient}>
          <span className="font-medium">{data.recipientName}</span>
        </DetailRow>
        <DetailRow icon={<MapPin className="size-4" />} label={f.t.deliveryAddress}>
          <span className="block leading-relaxed">{data.deliveryAddress}</span>
          <a
            href={mapsUrl(data.deliveryAddress)}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "-ml-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50",
              accentText(branded),
            )}
          >
            {f.t.openInMaps}
            <ArrowUpRight className="size-4" aria-hidden="true" />
            <span className="sr-only">{f.t.opensNewTab}</span>
          </a>
        </DetailRow>
        <DetailRow icon={<CalendarDays className="size-4" />} label={f.t.orderPlaced}>
          <time dateTime={data.createdAt} className="tabular-nums" suppressHydrationWarning>
            {f.fullDate(new Date(data.createdAt))}
          </time>
        </DetailRow>
        {codPaid(data) && data.codAmount ? (
          <DetailRow icon={<Banknote className="size-4" />} label={f.t.payment}>
            <span className="font-medium">{f.t.codPaid}</span>
            <span className="text-muted-foreground tabular-nums"> · {f.money(data.codAmount)}</span>
          </DetailRow>
        ) : null}
      </dl>

      {sender.phone ? (
        <div
          className={cn(
            "mt-5 rounded-xl p-4 ring-1 ring-inset",
            branded
              ? "bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] ring-[color-mix(in_srgb,var(--brand)_20%,transparent)]"
              : "bg-emerald-50 ring-emerald-100 dark:bg-emerald-950/40 dark:ring-emerald-900/50",
          )}
        >
          <p className="text-sm font-semibold">{f.t.questionsTitle}</p>
          <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{f.t.questionsBody(sender.name)}</p>
          <Button asChild className={cn("mt-3 h-12 w-full min-w-0 rounded-xl text-[15px]", accentButton(branded))}>
            <a href={telHref(sender.phone)}>
              <Phone className="size-4" aria-hidden="true" />
              <span className="truncate">{f.t.callSender(sender.name)}</span>
            </a>
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground tabular-nums">{sender.phone}</p>
        </div>
      ) : null}
    </Surface>
  );
}

// ─────────────────────────────────────────────────────────────
// Updates timeline — newest first
// ─────────────────────────────────────────────────────────────

const INITIAL_VISIBLE = 6;

function dotColor(eventType: string, newest: boolean): string {
  if (eventType === "FAILED") return "bg-amber-500";
  if (eventType === "CANCELLED") return "bg-slate-400 dark:bg-slate-500";
  if (eventType === "DELIVERED" || newest) return "bg-emerald-500";
  return "bg-zinc-300 dark:bg-zinc-600";
}

export function TrackingTimeline({ data, now, f }: { data: TrackingData; now: number; f: TrackingFormat }) {
  const [expanded, setExpanded] = useState(false);
  const events = data.timeline.slice().reverse(); // newest first
  const visible = expanded ? events : events.slice(0, INITIAL_VISIBLE);
  const hiddenCount = events.length - visible.length;

  return (
    <Surface aria-labelledby="tracking-updates" className={cn("p-5 sm:p-6", ENTER)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="tracking-updates" className="text-sm font-semibold">
          {f.t.updatesHeading}
        </h2>
        {events.length > 0 ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {f.t.updatesCount(events.length, f.number(events.length))}
          </span>
        ) : null}
      </div>

      {events.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{f.t.noUpdates}</p>
      ) : (
        <ol className="mt-5">
          {visible.map((ev, i) => {
            const newest = i === 0;
            const isLast = i === visible.length - 1;
            return (
              <li key={`${ev.timestamp}-${ev.eventType}-${i}`} className="flex gap-3.5">
                <div className="flex w-3 shrink-0 flex-col items-center" aria-hidden="true">
                  <span className={cn("mt-1 size-3 shrink-0 rounded-full ring-4", dotColor(ev.eventType, newest), newest ? "ring-emerald-500/15" : "ring-transparent")} />
                  {!isLast ? <span className="mt-2 w-px flex-1 bg-border dark:bg-white/10" /> : null}
                </div>
                <div className={cn("min-w-0 flex-1", !isLast && "pb-5")}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <p className={cn("text-sm", newest ? "font-semibold" : "font-medium")}>{eventLabel(ev.eventType, f)}</p>
                    <time
                      dateTime={ev.timestamp}
                      title={f.dateTime(new Date(ev.timestamp))}
                      className="text-xs text-muted-foreground tabular-nums"
                      suppressHydrationWarning
                    >
                      {eventTime(ev.timestamp, now, f)}
                    </time>
                  </div>
                  {ev.note ? (
                    <p className="mt-1.5 rounded-lg bg-muted/60 px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-line text-foreground/90 dark:bg-white/5">
                      {ev.note}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {hiddenCount > 0 || (expanded && events.length > INITIAL_VISIBLE) ? (
        <Button
          type="button"
          variant="ghost"
          className="mt-3 min-h-11 w-full rounded-xl text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? f.t.showFewer : f.t.showAll(f.number(events.length))}
          <ChevronDown className={cn("size-4 transition-transform duration-200", expanded && "rotate-180")} aria-hidden="true" />
        </Button>
      ) : null}
    </Surface>
  );
}
