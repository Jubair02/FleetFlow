"use client";

import { createContext, useContext } from "react";
import type { PlatformAdminInfo } from "@/lib/platform-types";

export type PlatformView = "overview" | "organizations" | "users" | "plans" | "analytics" | "audit" | "settings";

/** Tabs of the organization dialog (organizations/dialog/org-dialog.tsx). */
export type OrgDialogTab = "overview" | "users" | "subscription" | "deliveries" | "activity";

export interface OrgRef {
  id: string;
  name: string;
}

export interface ConsoleContextValue {
  admin: PlatformAdminInfo;
  view: PlatformView;
  setView: (view: PlatformView) => void;
  /** Open the organization dialog on a tab (default Overview); works from any view. */
  openOrg: (id: string, tab?: OrgDialogTab) => void;
  /** Jump to Users filtered to one organization. */
  showOrgUsers: (org: OrgRef) => void;
  /** Jump to Audit Logs filtered to one organization. */
  showOrgAudit: (org: OrgRef) => void;
  usersOrgFilter: OrgRef | null;
  setUsersOrgFilter: (org: OrgRef | null) => void;
  auditOrgFilter: OrgRef | null;
  setAuditOrgFilter: (org: OrgRef | null) => void;
  openPasswordDialog: () => void;
}

export const ConsoleContext = createContext<ConsoleContextValue | null>(null);

export function useConsole(): ConsoleContextValue {
  const ctx = useContext(ConsoleContext);
  if (!ctx) throw new Error("useConsole must be used inside <PlatformConsole>");
  return ctx;
}
