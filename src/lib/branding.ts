// ─────────────────────────────────────────────────────────────
// Tracking-page branding — client-safe, pure (no server imports).
//
// A company on a plan with "branded_tracking" can put its logo, an accent
// colour and a short message on every customer tracking page. The colour
// is never used as-is behind text: brandPalette() derives shades that keep
// WCAG AA contrast (4.5:1) for white text on the colour and for the colour
// as text on light / dark cards. Saving requires the feature; rendering
// checks it again, so a plan that loses it falls back to FleetFlow styling
// (the company name always shows). Server side: src/lib/tracking.ts,
// /api/settings/tracking, /api/brand/[orgId]/logo.
// ─────────────────────────────────────────────────────────────

export const BRANDED_TRACKING_FEATURE = "branded_tracking" as const;

/** Logo upload limit (PNG / JPEG / WebP only — never SVG, which can carry script). */
export const BRAND_LOGO_MAX_BYTES = 1024 * 1024;
export const BRAND_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const TRACKING_MESSAGE_MAX = 200;

/** Contrast WCAG AA asks for normal-size text. */
export const MIN_TEXT_CONTRAST = 4.5;

const HEX_RE = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

/** "#1a2b3c", "1A2B3C" or "#abc" → "#1A2B3C"; anything else → null. */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = HEX_RE.exec(value.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return `#${hex.toUpperCase()}`;
}

/** Strict stored form: exactly #RRGGBB. */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value);
}

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  const n = normalizeHexColor(hex);
  if (!n) throw new Error(`Invalid colour: ${hex}`);
  return [parseInt(n.slice(1, 3), 16), parseInt(n.slice(3, 5), 16), parseInt(n.slice(5, 7), 16)];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 … 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const WHITE = "#FFFFFF";
/** Near-black used for dark text on light accents. */
export const INK = "#111827";
/** Dark-mode card surface the accent must stay readable on (shadcn dark --card ≈ #171717). */
export const DARK_SURFACE = "#171717";

/** White or near-black — whichever reads better on `bg`. */
export function readableTextColor(bg: string): string {
  return contrastRatio(bg, WHITE) >= contrastRatio(bg, INK) ? WHITE : INK;
}

function mix(hex: string, target: string, t: number): string {
  const a = toRgb(hex);
  const b = toRgb(target);
  return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/**
 * The closest shade of `hex` (mixed toward `toward` in 5 % steps) that has at
 * least `min` contrast against `against`. Returns `hex` unchanged when it
 * already passes.
 */
export function adjustForContrast(hex: string, against: string, toward: string, min = MIN_TEXT_CONTRAST): string {
  const base = normalizeHexColor(hex);
  if (!base) throw new Error(`Invalid colour: ${hex}`);
  if (contrastRatio(base, against) >= min) return base;
  for (let i = 1; i <= 20; i++) {
    const shade = mix(base, toward, i / 20);
    if (contrastRatio(shade, against) >= min) return shade;
  }
  return normalizeHexColor(toward)!;
}

export interface BrandPalette {
  /** The colour exactly as chosen. */
  base: string;
  /** Background behind white text (hero, buttons): base, darkened if needed for 4.5:1. */
  solid: string;
  /** The colour as text / icons on a white card (same as `solid`). */
  inkLight: string;
  /** The colour as text / icons on a dark card: lightened if needed. */
  inkDark: string;
  /** Contrast of white text on the colour as chosen. */
  whiteContrast: number;
  /** True when the chosen colour had to be darkened for white text. */
  adjusted: boolean;
}

export function brandPalette(color: string): BrandPalette {
  const base = normalizeHexColor(color);
  if (!base) throw new Error(`Invalid colour: ${color}`);
  const solid = adjustForContrast(base, WHITE, "#000000");
  return {
    base,
    solid,
    inkLight: solid,
    inkDark: adjustForContrast(base, DARK_SURFACE, WHITE),
    whiteContrast: Math.round(contrastRatio(base, WHITE) * 100) / 100,
    adjusted: solid !== base,
  };
}

/** CSS custom properties the tracking page reads (see tracking-view.tsx). */
export function brandCssVars(color: string | null | undefined): Record<string, string> | undefined {
  const base = normalizeHexColor(color);
  if (!base) return undefined;
  const p = brandPalette(base);
  return { "--brand": p.base, "--brand-solid": p.solid, "--brand-ink": p.inkLight, "--brand-ink-dark": p.inkDark };
}

/** Accent presets offered in Settings (all pass 4.5:1 with white text). */
export const BRAND_PRESETS: readonly { name: string; value: string }[] = [
  { name: "Emerald", value: "#047857" },
  { name: "Teal", value: "#0F766E" },
  { name: "Ocean", value: "#1D4ED8" },
  { name: "Indigo", value: "#4338CA" },
  { name: "Violet", value: "#6D28D9" },
  { name: "Berry", value: "#BE185D" },
  { name: "Crimson", value: "#B91C1C" },
  { name: "Rust", value: "#C2410C" },
  { name: "Olive", value: "#4D7C0F" },
  { name: "Slate", value: "#334155" },
];

// ── logo address ─────────────────────────────────────────────

/** Short, stable version of a storage key (FNV-1a, hex) — changes whenever the logo is replaced. */
export function brandLogoVersion(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Public, cacheable address of an organization's logo (immutable per version). */
export function brandLogoUrl(organizationId: string, key: string): string {
  return `/api/brand/${encodeURIComponent(organizationId)}/logo?v=${brandLogoVersion(key)}`;
}

// ── what the tracking page shows ─────────────────────────────

export interface TrackingBranding {
  /** Same-origin logo address, or null. */
  logoUrl: string | null;
  /** #RRGGBB accent, or null for the default FleetFlow colours. */
  color: string | null;
  /** Short note from the company shown on every tracking page. */
  message: string | null;
}

export interface BrandingSource {
  id?: string | null;
  brandColor?: string | null;
  brandLogoKey?: string | null;
  trackingMessage?: string | null;
}

/**
 * Branding to apply, or null for default styling: the plan must include
 * branded_tracking (checked on every render, not only on save) and at least
 * one of logo / colour / message must be set.
 */
export function resolveTrackingBranding(org: BrandingSource, planFeatures: readonly string[] | null | undefined): TrackingBranding | null {
  if (!planFeatures?.includes(BRANDED_TRACKING_FEATURE)) return null;
  const color = isHexColor(org.brandColor) ? org.brandColor.toUpperCase() : null;
  const logoUrl = org.brandLogoKey && org.id ? brandLogoUrl(org.id, org.brandLogoKey) : null;
  const message = org.trackingMessage?.trim() ? org.trackingMessage.trim().slice(0, TRACKING_MESSAGE_MAX) : null;
  if (!color && !logoUrl && !message) return null;
  return { logoUrl, color, message };
}

// ── Settings → Tracking page (GET/PATCH /api/settings/tracking) ──

export interface TrackingSettings {
  brandColor: string | null;
  trackingMessage: string | null;
  logoUrl: string | null;
  allowCustomerRating: boolean;
  allowCustomerReschedule: boolean;
}

export interface TrackingSettingsResponse {
  settings: TrackingSettings;
  /** The plan includes branded_tracking (logo, colour and message are applied). */
  branded: boolean;
  planName: string;
  /** What the page header shows regardless of the plan. */
  company: { name: string; phone: string | null };
}
