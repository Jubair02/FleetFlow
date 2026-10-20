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
  | "driver-jobs"
  | "driver-history";

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
}));

/** Navigate to a delivery detail from anywhere (admin context). */
export function goToDelivery(id: string) {
  const { setView, focusDelivery } = useAppStore.getState();
  focusDelivery(id);
  setView("deliveries");
}
