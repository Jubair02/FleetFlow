"use client";

import { create } from "zustand";
import type { SessionUser } from "@/lib/types";
import { appLocation, type AppLocation, type AppView, type SettingsTab } from "@/lib/app-routes";
import { clearDataCache, revalidateData, type CacheKeyMatcher } from "@/lib/data-cache";

// Views, roles and addresses are defined in src/lib/app-routes.ts (shared with the server route).
export { ADMIN_VIEWS, DISPATCHER_VIEWS, DRIVER_VIEWS, allowedViews } from "@/lib/app-routes";
export type { AppView, SettingsTab } from "@/lib/app-routes";
export type { CacheKeyMatcher } from "@/lib/data-cache";

export type DeliveriesAction = "create" | "import" | null;

interface AppStore {
  session: SessionUser | null;
  setSession: (u: SessionUser | null) => void;
  // ── navigation (mirrored in the address bar by src/store/app-history.ts) ──
  view: AppView;
  /** Open another screen. Re-selecting the current screen keeps its tab / filter. */
  setView: (v: AppView) => void;
  /** Open delivery detail (deliveries view) or job detail (driver portal); null closes it. */
  focusDeliveryId: string | null;
  focusDelivery: (id: string | null) => void;
  /** Deliveries list status filter as shown in the address (?status=FAILED); null = all. */
  deliveriesStatus: string | null;
  setDeliveriesStatus: (status: string | null) => void;
  /** Settings tab as shown in the address (/settings/<tab>). */
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;
  /** Apply a whole location at once (address bar → store: boot, Back/Forward). */
  navigate: (loc: AppLocation) => void;
  /** One-shot action the Deliveries view runs when it mounts (open the create or import dialog), then clears. */
  deliveriesAction: DeliveriesAction;
  setDeliveriesAction: (action: DeliveriesAction) => void;
  // ── data refresh ──
  /** Incremented on every bump (kept for anything that wants to observe refreshes). */
  refreshKey: number;
  /**
   * Refetch cached API data after a mutation. No argument = every request
   * (what most mutations want); pass a URL prefix, a list of prefixes or a
   * predicate to refresh only those, e.g. bump("/api/notifications").
   */
  bump: (match?: CacheKeyMatcher) => void;
  /** Clear the session, all navigation state and the request cache (logout / expired session). */
  signOut: () => void;
}

const NAV_RESET = {
  view: "dashboard" as AppView,
  focusDeliveryId: null,
  deliveriesStatus: null,
  settingsTab: "company" as SettingsTab,
  deliveriesAction: null,
};

export const useAppStore = create<AppStore>((set) => ({
  session: null,
  setSession: (u) => set({ session: u }),
  ...NAV_RESET,
  setView: (v) =>
    set((s) => (s.view === v ? s : { view: v, deliveriesStatus: null, settingsTab: "company" })),
  focusDelivery: (id) => set({ focusDeliveryId: id }),
  setDeliveriesStatus: (status) => set({ deliveriesStatus: status }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  navigate: (loc) =>
    set((s) => ({
      view: loc.view,
      focusDeliveryId: loc.deliveryId,
      // A detail address carries no filter: keep the list's filter underneath it.
      deliveriesStatus: loc.deliveryId && s.view === loc.view ? s.deliveriesStatus : loc.status,
      settingsTab: loc.settingsTab,
    })),
  setDeliveriesAction: (action) => set({ deliveriesAction: action }),
  refreshKey: 0,
  bump: (match) => {
    set((s) => ({ refreshKey: s.refreshKey + 1 }));
    void revalidateData(match);
  },
  signOut: () => {
    set({ session: null, ...NAV_RESET });
    clearDataCache();
  },
}));

/** Navigate to a delivery's detail from anywhere (admin context). */
export function goToDelivery(id: string) {
  useAppStore.setState((s) => ({
    view: "deliveries",
    focusDeliveryId: id,
    deliveriesStatus: s.view === "deliveries" ? s.deliveriesStatus : null,
  }));
}

/** Open the Deliveries view pre-filtered to a status (admin context). */
export function goToDeliveries(status: string | null) {
  useAppStore.setState({ view: "deliveries", focusDeliveryId: null, deliveriesStatus: status });
}

/** Open the Deliveries view and immediately start creating or importing deliveries (admin context). */
export function goToDeliveriesAction(action: Exclude<DeliveriesAction, null>) {
  useAppStore.setState((s) => ({
    view: "deliveries",
    deliveriesAction: action,
    deliveriesStatus: s.view === "deliveries" ? s.deliveriesStatus : null,
  }));
}

/** Open a specific Settings tab (admin context). */
export function goToSettings(tab: SettingsTab = "company") {
  useAppStore.setState({ view: "settings", settingsTab: tab });
}

/** The store's navigation state as an address-bar location. */
export function currentAppLocation(s: Pick<AppStore, "view" | "focusDeliveryId" | "deliveriesStatus" | "settingsTab"> = useAppStore.getState()): AppLocation {
  return appLocation(s.view, { deliveryId: s.focusDeliveryId, status: s.deliveriesStatus, settingsTab: s.settingsTab });
}
