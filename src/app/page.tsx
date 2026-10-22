import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getPlatformAdmin } from "@/lib/platform-auth";
import { CompanyApp } from "@/components/fleetflow/company-app";

/**
 * Root entry: the shared sign-in screen, the company workspace and public
 * tracking links (/?track=…). Workspace routing is decided on the server
 * from the verified session — a FleetFlow staff session (and no company
 * session) goes to /platform. Tracking links are never redirected.
 * Authorization itself is enforced by every API route, not by this page.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (!params.track) {
    const [tenant, staff] = await Promise.all([getSessionUser(), getPlatformAdmin()]);
    if (staff && !tenant) redirect("/platform");
  }
  return <CompanyApp />;
}
