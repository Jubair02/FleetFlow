import type { Metadata } from "next";
import { isResetTokenUsable } from "@/lib/password-reset";
import { ResetPasswordView } from "@/components/fleetflow/auth/reset-password-view";

export const metadata: Metadata = {
  title: "Reset password · FleetFlow",
  description: null,
  // The URL carries a one-time secret: never index or cache it. (Referrer-Policy: no-referrer for this route, next.config.ts.)
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * /reset-password?token=… — target of the "forgot password" email
 * (src/lib/password-reset.ts). The token is checked up front so an expired
 * link says so before the user types a new password; it is consumed only by
 * POST /api/auth/reset-password.
 */
export default async function ResetPasswordPage({ searchParams }: Props) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token.trim() : "";
  const usable = token ? await isResetTokenUsable(token).catch(() => false) : false;
  return <ResetPasswordView token={usable ? token : null} />;
}
