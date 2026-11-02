// ─────────────────────────────────────────────────────────────
// Company app screens ↔ web addresses. Pure (no React, no DOM) so the
// server route, the client store and the unit tests share one definition.
//
//   /dashboard  /deliveries[?status=FAILED]  /deliveries/<id>  /dispatch  /map
//   /drivers  /vehicles  /reports  /cod  /notifications  /audit
//   /settings  /settings/<team|plan|developers|tracking|zones>   (company tab = /settings)
//   /jobs  /jobs/<id>  /history  /history/<id>    (driver portal)
// ─────────────────────────────────────────────────────────────

export type AppView =
  | "dashboard"
  | "deliveries"
  | "dispatch"
  | "map"
  | "drivers"
  | "vehicles"
  | "reports"
  | "cod"
  | "notifications"
  | "audit"
  | "settings"
  | "driver-jobs"
  | "driver-history";

export type SettingsTab = "company" | "team" | "plan" | "developers" | "tracking" | "zones";
export const SETTINGS_TABS: readonly SettingsTab[] = ["company", "team", "plan", "developers", "tracking", "zones"];

export const ADMIN_VIEWS: AppView[] = ["dashboard", "deliveries", "dispatch", "map", "drivers", "vehicles", "reports", "cod", "notifications", "audit", "settings"];
/** Dispatchers run operations only — no settings, team, billing or audit (src/lib/roles.ts). */
export const DISPATCHER_VIEWS: AppView[] = ADMIN_VIEWS.filter((v) => v !== "audit" && v !== "settings");
export const DRIVER_VIEWS: AppView[] = ["driver-jobs", "driver-history", "notifications"];

/** Views a role may open; anything else falls back to the role's home view. */
export function allowedViews(role: string): AppView[] {
  return role === "DRIVER" ? DRIVER_VIEWS : role === "DISPATCHER" ? DISPATCHER_VIEWS : ADMIN_VIEWS;
}

export function homeView(role: string): AppView {
  return role === "DRIVER" ? "driver-jobs" : "dashboard";
}

export const VIEW_TITLES: Record<AppView, string> = {
  dashboard: "Operations Dashboard",
  deliveries: "Deliveries",
  dispatch: "Dispatch Board",
  map: "Live Map",
  drivers: "Drivers",
  vehicles: "Vehicles",
  reports: "Reports & Analytics",
  cod: "Cash on Delivery",
  notifications: "Notifications",
  audit: "Audit Log",
  settings: "Settings",
  "driver-jobs": "My Jobs",
  "driver-history": "My History",
};

/** First path segment of each view. */
const VIEW_SEGMENTS: Record<AppView, string> = {
  dashboard: "dashboard",
  deliveries: "deliveries",
  dispatch: "dispatch",
  map: "map",
  drivers: "drivers",
  vehicles: "vehicles",
  reports: "reports",
  cod: "cod",
  notifications: "notifications",
  audit: "audit",
  settings: "settings",
  "driver-jobs": "jobs",
  "driver-history": "history",
};

const SEGMENT_VIEWS = new Map<string, AppView>(Object.entries(VIEW_SEGMENTS).map(([view, seg]) => [seg, view as AppView]));

/** Views whose address can carry an open delivery (/deliveries/<id>, /jobs/<id>, /history/<id>). */
const DETAIL_VIEWS: ReadonlySet<AppView> = new Set<AppView>(["deliveries", "driver-jobs", "driver-history"]);

// Database ids are cuids; accept any URL-safe token and let the API decide whether it exists.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Delivery statuses are UPPER_SNAKE (src/lib/constants.ts); the API validates the value itself.
const STATUS_RE = /^[A-Z_]{2,32}$/;

/** Everything about the current screen that lives in the address bar. */
export interface AppLocation {
  view: AppView;
  /** Open delivery detail (deliveries view) or job detail (driver portal). */
  deliveryId: string | null;
  settingsTab: SettingsTab;
  /** Deliveries list status filter (?status=…). */
  status: string | null;
}

export function appLocation(view: AppView, extra: Partial<Omit<AppLocation, "view">> = {}): AppLocation {
  return { view, deliveryId: null, settingsTab: "company", status: null, ...extra };
}

/** Canonical address (path + query) of a screen. Fields that don't apply to the view are dropped. */
export function appPath(loc: AppLocation): string {
  const base = `/${VIEW_SEGMENTS[loc.view]}`;
  if (DETAIL_VIEWS.has(loc.view) && loc.deliveryId && ID_RE.test(loc.deliveryId)) return `${base}/${loc.deliveryId}`;
  if (loc.view === "deliveries" && loc.status && STATUS_RE.test(loc.status)) return `${base}?status=${loc.status}`;
  if (loc.view === "settings" && loc.settingsTab !== "company") return `${base}/${loc.settingsTab}`;
  return base;
}

/**
 * Read a screen from an address. Returns null for "/" and for anything that
 * isn't a company-app screen (the caller shows the role's home view).
 * Lenient about extras: an unknown settings tab opens Company, a malformed
 * delivery id opens the list — the caller then rewrites the address to the
 * canonical form.
 */
export function parseAppPath(pathname: string, search = ""): AppLocation | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  let first: string;
  try {
    first = decodeURIComponent(segments[0]).toLowerCase();
  } catch {
    return null;
  }
  const view = SEGMENT_VIEWS.get(first);
  if (!view) return null;
  const second = segments[1] ?? null;
  const loc = appLocation(view);

  if (DETAIL_VIEWS.has(view) && second && ID_RE.test(second)) loc.deliveryId = second;
  if (view === "settings" && second) {
    const tab = second.toLowerCase() as SettingsTab;
    if (SETTINGS_TABS.includes(tab)) loc.settingsTab = tab;
  }
  if (view === "deliveries" && !loc.deliveryId) {
    const status = new URLSearchParams(search).get("status")?.toUpperCase() ?? null;
    if (status && STATUS_RE.test(status) && status !== "ALL") loc.status = status;
  }
  return loc;
}

/** Apply the role guard: unknown or not-allowed screens become the role's home view. */
export function resolveAppLocation(loc: AppLocation | null, role: string): AppLocation {
  if (loc && allowedViews(role).includes(loc.view)) return loc;
  return appLocation(homeView(role));
}

/**
 * How a screen change should touch browser history:
 *  - push           another screen (Back returns to the previous one)
 *  - push-overlay   a detail dialog opened over the list it belongs to
 *  - close-overlay  that dialog closed (step back if we pushed it, else replace)
 *  - replace        tab / filter / detail-to-detail changes (no new history entry)
 */
export type HistoryMode = "push" | "push-overlay" | "close-overlay" | "replace";

export function historyMode(prev: AppLocation, next: AppLocation): HistoryMode {
  if (prev.view !== next.view) return "push";
  const prevId = DETAIL_VIEWS.has(prev.view) ? prev.deliveryId : null;
  const nextId = DETAIL_VIEWS.has(next.view) ? next.deliveryId : null;
  if (!prevId && nextId) return "push-overlay";
  if (prevId && !nextId) return "close-overlay";
  return "replace";
}
