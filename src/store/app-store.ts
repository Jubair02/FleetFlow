"use client";

import { create } from "zustand";
import type { SessionUser } from "@/lib/types";

export type AppView =
  | "dashboard"
  | "deliveries"
  | "dispatch"
  | "drivers"
  | "vehicles"
  | "reports"
  | "notifications"
  | "audit"
  | "settings"
  | "driver-jobs"
  | "driver-history";

export type DeliveriesAction = "create" | "import" | null;
export type SettingsTab = "company" | "team" | "plan";

interface AppStore {
  session: SessionUser | null;
  setSession: (u: SessionUser | null) => void;
  view: AppView;
  setView: (v: AppView) => void;
  /** Bump to trigger a data refetch in every mounted view. */
  refreshKey: number;
  bump: () => void;
  /** Navigate to a delivery's detail (deliveries view / driver portal). */
  focusDeliveryId: string | null;
  focusDelivery: (id: string | null) => void;
  /** One-shot status filter the Deliveries view applies when it mounts (e.g. "FAILED"). */
  deliveriesStatusPreset: string | null;
  setDeliveriesStatusPreset: (status: string | null) => void;
  /** One-shot action the Deliveries view runs when it mounts (open the create or import dialog), then clears. */
  deliveriesAction: DeliveriesAction;
  setDeliveriesAction: (action: DeliveriesAction) => void;
  /** One-shot tab the Settings view opens on when it mounts. */
  settingsTabPreset: SettingsTab | null;
  setSettingsTabPreset: (tab: SettingsTab | null) => void;
  /** Clear the session and all navigation state (logout / expired session). */
  signOut: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  session: null,
  setSession: (u) => set({ session: u }),
  view: "dashboard",
  setView: (v) => set({ view: v }),
  refreshKey: 0,
  bump: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
  focusDeliveryId: null,
  focusDelivery: (id) => set({ focusDeliveryId: id }),
  deliveriesStatusPreset: null,
  setDeliveriesStatusPreset: (status) => set({ deliveriesStatusPreset: status }),
  deliveriesAction: null,
  setDeliveriesAction: (action) => set({ deliveriesAction: action }),
  settingsTabPreset: null,
  setSettingsTabPreset: (tab) => set({ settingsTabPreset: tab }),
  signOut: () =>
    set({
      session: null,
      view: "dashboard",
      focusDeliveryId: null,
      deliveriesStatusPreset: null,
      deliveriesAction: null,
      settingsTabPreset: null,
    }),
}));

export const ADMIN_VIEWS: AppView[] = ["dashboard", "deliveries", "dispatch", "drivers", "vehicles", "reports", "notifications", "audit", "settings"];
export const DRIVER_VIEWS: AppView[] = ["driver-jobs", "driver-history", "notifications"];

/** Views a role may open; anything else falls back to the role's home view. */
export function allowedViews(role: string): AppView[] {
  return role === "DRIVER" ? DRIVER_VIEWS : ADMIN_VIEWS;
}

/** Navigate to a delivery detail from anywhere (admin context). */
export function goToDelivery(id: string) {
  const { setView, focusDelivery } = useAppStore.getState();
  focusDelivery(id);
  setView("deliveries");
}

/** Open the Deliveries view pre-filtered to a status (admin context). */
export function goToDeliveries(status: string | null) {
  const { setView, setDeliveriesStatusPreset } = useAppStore.getState();
  setDeliveriesStatusPreset(status);
  setView("deliveries");
}

/** Open the Deliveries view and immediately start creating or importing deliveries (admin context). */
export function goToDeliveriesAction(action: Exclude<DeliveriesAction, null>) {
  const { setView, setDeliveriesAction } = useAppStore.getState();
  setDeliveriesAction(action);
  setView("deliveries");
}

/** Open a specific Settings tab (admin context). */
export function goToSettings(tab: SettingsTab = "company") {
  const { setView, setSettingsTabPreset } = useAppStore.getState();
  setSettingsTabPreset(tab);
  setView("settings");
}
