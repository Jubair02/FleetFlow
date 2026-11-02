// ─────────────────────────────────────────────────────────────
// Company roles — client-safe.
//   ADMIN       everything: settings, team, billing, audit + operations
//   DISPATCHER  operations only: deliveries, import, dispatch, drivers,
//               vehicles, reports, cash on delivery
//   DRIVER      their own jobs
// The owner (User.isOwner, the sign-up account) is an ADMIN that other
// admins can't deactivate or reset.
// ─────────────────────────────────────────────────────────────

export type UserRole = "ADMIN" | "DISPATCHER" | "DRIVER";
export type StaffRole = Exclude<UserRole, "DRIVER">;

export const STAFF_ROLES: readonly StaffRole[] = ["ADMIN", "DISPATCHER"];

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin",
  DISPATCHER: "Dispatcher",
  DRIVER: "Driver",
};

/** Admins and dispatchers — anyone who works in the company app rather than the driver portal. */
export function isStaffRole(role: string | null | undefined): role is StaffRole {
  return role === "ADMIN" || role === "DISPATCHER";
}

export function isAdminRole(role: string | null | undefined): role is "ADMIN" {
  return role === "ADMIN";
}
