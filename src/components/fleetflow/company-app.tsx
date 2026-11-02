"use client";

// Company workspace (moved from src/app/page.tsx, which is now a server
// component that routes platform staff to /platform before rendering this).
// Every screen has its own address (src/lib/app-routes.ts) and is loaded
// only when first opened.

import { Component, lazy, Suspense, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { RotateCcw, Truck } from "lucide-react";
import { api } from "@/lib/api-client";
import { allowedViews, homeView, type AppView } from "@/lib/app-routes";
import { useAppStore } from "@/store/app-store";
import { adoptAddress, startHistorySync } from "@/store/app-history";
import type { SessionUser } from "@/lib/types";
import { AppShell } from "@/components/fleetflow/app-shell";
import { LoginView } from "@/components/fleetflow/login-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// ── Screens, each in its own chunk ───────────────────────────
// A failed chunk download (flaky mobile data) is retried once before the
// error boundary below offers a reload.
function withRetry<T>(load: () => Promise<T>): () => Promise<T> {
  return () => load().catch(() => new Promise<T>((resolve, reject) => setTimeout(() => load().then(resolve, reject), 1500)));
}

const VIEW_LOADERS = {
  dashboard: withRetry(() => import("@/components/fleetflow/dashboard-view").then((m) => ({ default: m.DashboardView }))),
  deliveries: withRetry(() => import("@/components/fleetflow/deliveries-view").then((m) => ({ default: m.DeliveriesView }))),
  dispatch: withRetry(() => import("@/components/fleetflow/dispatch-view").then((m) => ({ default: m.DispatchView }))),
  map: withRetry(() => import("@/components/fleetflow/map/live-map-view").then((m) => ({ default: m.LiveMapView }))),
  drivers: withRetry(() => import("@/components/fleetflow/drivers-view").then((m) => ({ default: m.DriversView }))),
  vehicles: withRetry(() => import("@/components/fleetflow/vehicles-view").then((m) => ({ default: m.VehiclesView }))),
  reports: withRetry(() => import("@/components/fleetflow/reports-view").then((m) => ({ default: m.ReportsView }))),
  cod: withRetry(() => import("@/components/fleetflow/cod-view").then((m) => ({ default: m.CodView }))),
  notifications: withRetry(() => import("@/components/fleetflow/notifications-view").then((m) => ({ default: m.NotificationsView }))),
  audit: withRetry(() => import("@/components/fleetflow/audit-view").then((m) => ({ default: m.AuditView }))),
  settings: withRetry(() => import("@/components/fleetflow/settings-view").then((m) => ({ default: m.SettingsView }))),
  "driver-jobs": withRetry(() => import("@/components/fleetflow/driver-portal-view").then((m) => ({ default: m.DriverPortalView }))),
} satisfies Record<Exclude<AppView, "driver-history">, () => Promise<{ default: React.ComponentType }>>;

const DriverPortal = lazy(VIEW_LOADERS["driver-jobs"]);

const VIEWS: Record<AppView, React.LazyExoticComponent<React.ComponentType>> = {
  dashboard: lazy(VIEW_LOADERS.dashboard),
  deliveries: lazy(VIEW_LOADERS.deliveries),
  dispatch: lazy(VIEW_LOADERS.dispatch),
  map: lazy(VIEW_LOADERS.map),
  drivers: lazy(VIEW_LOADERS.drivers),
  vehicles: lazy(VIEW_LOADERS.vehicles),
  reports: lazy(VIEW_LOADERS.reports),
  cod: lazy(VIEW_LOADERS.cod),
  notifications: lazy(VIEW_LOADERS.notifications),
  audit: lazy(VIEW_LOADERS.audit),
  settings: lazy(VIEW_LOADERS.settings),
  // One component for both, so switching Jobs ↔ History keeps it mounted (as before).
  "driver-jobs": DriverPortal,
  "driver-history": DriverPortal,
};

const SignupView = lazy(withRetry(() => import("@/components/fleetflow/signup-view").then((m) => ({ default: m.SignupView }))));

/** Warm the chunks of the other screens a staff member may open, once the browser is idle (skipped on data saver). */
function usePrefetchViews(role: string | undefined, current: AppView) {
  useEffect(() => {
    if (!role || role === "DRIVER") return; // drivers: small set, loaded on demand to spare mobile data
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    const run = () => {
      for (const v of allowedViews(role)) {
        if (v !== current && v !== "driver-history") void VIEW_LOADERS[v]().catch(() => undefined);
      }
    };
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1));
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;
    let handle: number | undefined;
    const delay = window.setTimeout(() => {
      handle = idle(run);
    }, 3000);
    return () => {
      window.clearTimeout(delay);
      if (handle !== undefined) cancelIdle(handle);
    };
    // Once per sign-in (not per screen): the first screen is already loading, the rest can wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on the role only
  }, [role]);
}

/** Placeholder while a screen's code downloads — fills the content area so nothing jumps. */
function ViewFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl max-sm:hidden" />
        <Skeleton className="h-24 rounded-xl max-lg:hidden" />
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

/** A screen's code couldn't be downloaded (offline, or a new deploy replaced it). */
class ViewLoadBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean; resetKey: string }> {
  state = { failed: false, resetKey: this.props.resetKey };
  static getDerivedStateFromProps(props: { resetKey: string }, state: { failed: boolean; resetKey: string }) {
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null;
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-auto mt-12 flex max-w-sm flex-col items-center gap-3 text-center">
        <p className="text-sm font-medium">This screen couldn&apos;t be loaded.</p>
        <p className="text-sm text-muted-foreground">Check your connection, then reload the page.</p>
        <Button variant="outline" className="min-h-11" onClick={() => window.location.reload()}>
          <RotateCcw aria-hidden /> Reload
        </Button>
      </div>
    );
  }
}

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <div className="flex size-14 animate-pulse items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        <Truck className="size-8" />
      </div>
      <div className="text-sm font-medium text-muted-foreground">Loading FleetFlow…</div>
    </div>
  );
}

function AppInner() {
  const session = useAppStore((s) => s.session);
  const setSession = useAppStore((s) => s.setSession);
  const setView = useAppStore((s) => s.setView);
  const view = useAppStore((s) => s.view);
  const [booting, setBooting] = useState(true);
  const [authScreen, setAuthScreen] = useState<"login" | "signup">("login");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ user: SessionUser | null }>("/api/auth/me");
        if (!cancelled && res.user) setSession(res.user);
      } catch {
        /* not signed in */
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setSession]);

  // Address bar ↔ screen. On boot or sign-in the address wins (a deep link
  // opened while signed out lands on that screen once signed in, if the role
  // may open it); from then on the store and history are kept in step.
  // A layout effect, so the screen chosen before the address was read (the
  // sign-in form picks the role's home) never paints or starts loading.
  const role = session?.role;
  const sessionKey = session ? `${session.id}:${session.role}` : null;
  const [adoptedKey, setAdoptedKey] = useState<string | null>(null);
  if (!sessionKey && adoptedKey) setAdoptedKey(null);
  useLayoutEffect(() => {
    if (!sessionKey || !role) return;
    adoptAddress(role);
    setAdoptedKey(sessionKey); // eslint-disable-line react-hooks/set-state-in-effect -- must follow the store update above
    return startHistorySync(role);
  }, [sessionKey, role]);

  // Role guard: a view the current role may not open falls back to the role's home.
  const home: AppView = homeView(session?.role ?? "");
  const viewAllowed = !session || allowedViews(session.role).includes(view);
  useEffect(() => {
    if (!viewAllowed) setView(home);
  }, [viewAllowed, home, setView]);
  const activeView = viewAllowed ? view : home;
  usePrefetchViews(adoptedKey ? role : undefined, activeView);

  if (booting) return <Splash />;
  if (!session) {
    return authScreen === "signup" ? (
      <Suspense fallback={<Splash />}>
        <SignupView onSignIn={() => setAuthScreen("login")} />
      </Suspense>
    ) : (
      <LoginView onCreateAccount={() => setAuthScreen("signup")} />
    );
  }
  if (adoptedKey !== sessionKey) return null; // replaced before paint by the layout effect above

  const ActiveView = VIEWS[activeView];
  return (
    <AppShell>
      <ViewLoadBoundary resetKey={activeView}>
        <Suspense fallback={<ViewFallback />}>
          <ActiveView />
        </Suspense>
      </ViewLoadBoundary>
    </AppShell>
  );
}

/** The company workspace SPA (admins, dispatchers, drivers). Public tracking lives at /track/[token]. */
export function CompanyApp() {
  return (
    <Suspense fallback={<Splash />}>
      <AppInner />
    </Suspense>
  );
}
