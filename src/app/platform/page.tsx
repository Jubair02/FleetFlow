import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getPlatformAdmin } from "@/lib/platform-auth";
import type { PlatformAdminInfo } from "@/lib/platform-types";
import { PlatformConsole } from "@/components/platform/platform-console";

export const metadata: Metadata = {
  title: "FleetFlow Platform",
  description: "FleetFlow internal operations console.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

/**
 * Super admin console entry. Sign-in happens on the shared form at "/";
 * without a staff session this page redirects (company users back to their
 * workspace, everyone else to sign-in). Every /api/platform/* route still
 * authorizes on its own (requirePlatformAdmin).
 */
export default async function PlatformPage() {
  const admin = await getPlatformAdmin();
  if (!admin) {
    redirect((await getSessionUser()) ? "/" : "/?next=platform");
  }

  // Only safe, serializable fields cross to the client.
  const initialAdmin: PlatformAdminInfo = {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    mustChangePassword: admin.mustChangePassword,
    lastLoginAt: admin.lastLoginAt ? admin.lastLoginAt.toISOString() : null,
    createdAt: admin.createdAt.toISOString(),
  };
  return <PlatformConsole initialAdmin={initialAdmin} />;
}
