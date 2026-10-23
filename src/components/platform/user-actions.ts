import type { PlatformUserRow, UserAction } from "@/lib/platform-types";
import { bumpPlatformData, platformApi } from "./platform-api";

// Per-user platform actions (PATCH /api/platform/users/[id]) — shared by the
// Users view and the organization dialog's Users tab.

export const USER_ACTION_COPY: Record<UserAction["action"], { title: (u: PlatformUserRow) => string; description: string; confirm: string; destructive?: boolean }> = {
  deactivate: {
    title: (u) => `Deactivate ${u.name}?`,
    description:
      "They are signed out everywhere and can't sign in until reactivated. Their deliveries, history and audit trail are kept. Their organization's admins can see the change.",
    confirm: "Deactivate",
    destructive: true,
  },
  activate: {
    title: (u) => `Reactivate ${u.name}?`,
    description: "They can sign in again with their existing password. Plan limits for the organization may block reactivation if it is at its limit.",
    confirm: "Reactivate",
  },
  "reset-password": {
    title: (u) => `Reset password for ${u.name}?`,
    description:
      "Their current password stops working and they are signed out everywhere. A temporary password is shown to you once — share it privately; they must choose a new one at next sign-in.",
    confirm: "Reset password",
    destructive: true,
  },
  "revoke-sessions": {
    title: (u) => `Sign ${u.name} out everywhere?`,
    description: "Ends every active session on all devices. Their password is unchanged — they can sign in again straight away.",
    confirm: "Sign out everywhere",
  },
};

/** Run a user action; resolves with the one-time temporary password for "reset-password". */
export async function runUserAction(user: Pick<PlatformUserRow, "id">, action: UserAction["action"]): Promise<{ temporaryPassword?: string }> {
  const res = await platformApi.patch<{ success: boolean; temporaryPassword?: string }>(`/api/platform/users/${encodeURIComponent(user.id)}`, {
    action,
  } satisfies UserAction);
  bumpPlatformData();
  return res;
}

export function userActionSuccess(user: Pick<PlatformUserRow, "name">, action: UserAction["action"]): string {
  return action === "deactivate"
    ? `${user.name} deactivated`
    : action === "activate"
      ? `${user.name} reactivated`
      : action === "revoke-sessions"
        ? `${user.name} signed out everywhere`
        : `Password reset for ${user.name}`;
}
