"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Info, LoaderCircle, Lock, Mail, Truck } from "lucide-react";
import type { PlatformAdminInfo } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { platformApi } from "./platform-api";
import { EMAIL_RE, PlatformBadge, ServerError } from "./shared";

/**
 * Sign-in for FleetFlow staff. With `onSignedIn` the console swaps views in place;
 * without it (first load from the server page) the route is refreshed so the
 * server component re-checks the session and renders the console.
 */
export function PlatformLogin({ onSignedIn, notice }: { onSignedIn?: (admin: PlatformAdminInfo) => void; notice?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    const em = email.trim();
    if (!em || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (!EMAIL_RE.test(em)) {
      setError("Enter a valid email address.");
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await platformApi.post<{ admin: PlatformAdminInfo }>("/api/platform/auth/login", { email: em, password });
      setPassword("");
      if (onSignedIn) onSignedIn(res.admin);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-muted/30">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-2.5">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Truck className="size-6" aria-hidden />
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                FleetFlow <PlatformBadge />
              </div>
              <div className="text-xs text-muted-foreground">Operations console</div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h1 className="text-xl font-semibold tracking-tight">Staff sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">For FleetFlow staff only. Company admins and drivers sign in at the main app.</p>

            {notice && (
              <p className="mt-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" role="status">
                {notice}
              </p>
            )}

            <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="pf-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="pf-email"
                    type="email"
                    autoComplete="username"
                    placeholder="you@fleetflow.app"
                    className="pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    maxLength={254}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pf-password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="pf-password"
                    type="password"
                    autoComplete="current-password"
                    className="pl-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    maxLength={200}
                  />
                </div>
              </div>
              <ServerError message={error} />
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <LoaderCircle className="animate-spin" aria-hidden />}
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </div>

          <div className="mt-4 flex gap-2 rounded-lg border bg-card px-3 py-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p>
              There is no self sign-up. Platform accounts are created by an operator with{" "}
              <code className="rounded bg-muted px-1 font-mono text-[11px]">scripts/create-super-admin.mjs</code>. Every action here
              is recorded in the platform audit log.
            </p>
          </div>
        </div>
      </div>
      <footer className="border-t bg-background">
        <div className="flex items-center justify-center px-6 py-3 text-xs text-muted-foreground">
          © {new Date().getFullYear()} FleetFlow — Platform operations
        </div>
      </footer>
    </div>
  );
}
