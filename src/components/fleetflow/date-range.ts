import { addDays, format, isValid, parseISO } from "date-fns";

// ─────────────────────────────────────────────────────────────
// Date-range helpers for list/report filters.
// Contract (see src/lib/types.ts): `from` = local midnight of the first
// day (inclusive), `to` = local midnight of the day AFTER the last day
// (exclusive), both sent as ISO instants.
// ─────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" from an <input type="date"> → local-midnight Date (or null). */
function localDay(value: string): Date | null {
  if (!value) return null;
  const d = parseISO(value); // date-only strings parse as LOCAL midnight
  return isValid(d) ? d : null;
}

/** Inclusive lower bound as an ISO instant, or null when unset/invalid. */
export function rangeFromParam(day: string): string | null {
  return localDay(day)?.toISOString() ?? null;
}

/** Exclusive upper bound (local midnight of the next day) as an ISO instant. */
export function rangeToParam(day: string): string | null {
  const d = localDay(day);
  return d ? addDays(d, 1).toISOString() : null;
}

/** True when both days are set and `from` is after `to`. */
export function isRangeInverted(from: string, to: string): boolean {
  const a = localDay(from);
  const b = localDay(to);
  return !!a && !!b && a.getTime() > b.getTime();
}

/** Chart axis label for a "YYYY-MM-DD" bucket (parsed as a local date). */
export function dayTick(value: unknown): string {
  const d = parseISO(String(value));
  return isValid(d) ? format(d, "d MMM") : String(value);
}

/** Chart tooltip label for a "YYYY-MM-DD" bucket. */
export function dayTooltipLabel(label: unknown): string {
  const d = parseISO(String(label));
  return isValid(d) ? format(d, "EEE d MMM yyyy") : String(label);
}

/** Shared Recharts tooltip styling that follows the light/dark theme tokens. */
export const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    borderRadius: 8,
    fontSize: 12,
    background: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
  },
  labelStyle: { color: "var(--popover-foreground)" },
} as const;
