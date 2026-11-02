import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getPlatformAdmin } from "@/lib/platform-auth";
import { CompanyApp } from "@/components/fleetflow/company-app";

/**
 * Shared by "/" and every company-app address (/deliveries/…, /settings/…):
 * workspace routing is decided on the server from the verified session — a
 * FleetFlow staff session (and no company session) goes to /platform.
 * Authorization itself is enforced by every API route, not by this page;
 * which screen opens (and whether the role may open it) is decided on the
 * client from the address (src/lib/app-routes.ts).
 */
export async function CompanyEntry() {
  const [tenant, staff] = await Promise.all([getSessionUser(), getPlatformAdmin()]);
  if (staff && !tenant) redirect("/platform");
  return <CompanyApp />;
}
