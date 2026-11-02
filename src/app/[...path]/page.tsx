import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VIEW_TITLES, parseAppPath } from "@/lib/app-routes";
import { CompanyEntry } from "../_company/company-entry";

/**
 * Company-app screen addresses (/dashboard, /deliveries/<id>, /settings/plan,
 * /jobs …). Static routes (/platform, /track/<token>, /reset-password, /api/*)
 * take precedence over this catch-all. Every address renders the same
 * client app, which opens the screen the address names — or the role's home
 * screen when it is unknown or not allowed.
 */
type Props = { params: Promise<{ path: string[] }> };

/** Unmatched API calls and missing files get a real 404, not the app. */
function isAppAddress(path: string[]): boolean {
  const first = path[0] ?? "";
  return first !== "api" && first !== "_next" && !first.includes(".");
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path } = await params;
  const loc = parseAppPath(`/${path.join("/")}`);
  return loc ? { title: `${VIEW_TITLES[loc.view]} · FleetFlow` } : {};
}

export default async function AppScreenPage({ params }: Props) {
  const { path } = await params;
  if (!isAppAddress(path)) notFound();
  return <CompanyEntry />;
}
