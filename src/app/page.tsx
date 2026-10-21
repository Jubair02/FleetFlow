"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Truck } from "lucide-react";
import { api } from "@/lib/api-client";
import { allowedViews, useAppStore, type AppView } from "@/store/app-store";
import type { SessionUser } from "@/lib/types";
import { AppShell } from "@/components/fleetflow/app-shell";
import { LoginView } from "@/components/fleetflow/login-view";
import { SignupView } from "@/components/fleetflow/signup-view";
import { TrackingView } from "@/components/fleetflow/tracking-view";
import { DashboardView } from "@/components/fleetflow/dashboard-view";
import { DeliveriesView } from "@/components/fleetflow/deliveries-view";
import { DispatchView } from "@/components/fleetflow/dispatch-view";
import { DriversView } from "@/components/fleetflow/drivers-view";
import { VehiclesView } from "@/components/fleetflow/vehicles-view";
import { ReportsView } from "@/components/fleetflow/reports-view";
import { NotificationsView } from "@/components/fleetflow/notifications-view";
import { AuditView } from "@/components/fleetflow/audit-view";
import { DriverPortalView } from "@/components/fleetflow/driver-portal-view";
import { SettingsView } from "@/components/fleetflow/settings-view";

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
  const searchParams = useSearchParams();
  const trackToken = searchParams.get("track");
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

  // Role guard: a view the current role may not open falls back to the role's home.
  const homeView: AppView = session?.role === "DRIVER" ? "driver-jobs" : "dashboard";
  const viewAllowed = !session || allowedViews(session.role).includes(view);
  useEffect(() => {
    if (!viewAllowed) setView(homeView);
  }, [viewAllowed, homeView, setView]);
  const activeView = viewAllowed ? view : homeView;

  // Public tracking page — no authentication required.
  // key remounts on token change so each link gets a fresh fetch cycle.
  if (trackToken) return <TrackingView key={trackToken} token={trackToken} />;
  if (booting) return <Splash />;
  if (!session) {
    return authScreen === "signup" ? (
      <SignupView onSignIn={() => setAuthScreen("login")} />
    ) : (
      <LoginView onCreateAccount={() => setAuthScreen("signup")} />
    );
  }

  return (
    <AppShell>
      {activeView === "dashboard" && <DashboardView />}
      {activeView === "deliveries" && <DeliveriesView />}
      {activeView === "dispatch" && <DispatchView />}
      {activeView === "drivers" && <DriversView />}
      {activeView === "vehicles" && <VehiclesView />}
      {activeView === "reports" && <ReportsView />}
      {activeView === "notifications" && <NotificationsView />}
      {activeView === "audit" && <AuditView />}
      {activeView === "settings" && <SettingsView />}
      {(activeView === "driver-jobs" || activeView === "driver-history") && <DriverPortalView />}
    </AppShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Splash />}>
      <AppInner />
    </Suspense>
  );
}
