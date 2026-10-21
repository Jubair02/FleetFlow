import type { Metadata } from "next";
import { getPlatformAdmin } from "@/lib/platform-auth";
import type { PlatformAdminInfo } from "@/lib/platform-types";
import { PlatformConsole } from "@/components/platform/platform-console";
import { PlatformLogin } from "@/components/platform/platform-login";

export const metadata: Metadata = {
  title: "FleetFlow Platform",
  description: "FleetFlow internal operations console.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

/**
 * Super admin console entry. This check only decides what to render —
 * every /api/platform/* route authorizes on its own (requirePlatformAdmin).
 * Reading cookies makes this route render per request.
 */
export default async function PlatformPage() {
  const admin = await getPlatformAdmin();
  if (!admin) return <PlatformLogin />;

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
