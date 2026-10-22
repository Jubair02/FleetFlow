"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { Truck, Mail, Lock, LoaderCircle, ShieldCheck, Users, UserCheck, Building2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { SessionUser } from "@/lib/types";

/** /api/auth/login: where to go is decided by the server from the verified account. */
type LoginResponse = { kind: "tenant"; user: SessionUser; redirectTo: "/" } | { kind: "platform"; redirectTo: "/platform" };
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

// One-click demo sign-in exists only for demo deployments (NEXT_PUBLIC_DEMO_MODE=true),
// never on a production instance holding real customer data.
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

const DEMO_ACCOUNTS = [
  { label: "Dispatcher / Admin", email: "admin@fleetflow.test", password: "Admin123!", icon: ShieldCheck, desc: "Full control — SwiftDrop Logistics" },
  { label: "Driver", email: "driver@fleetflow.test", password: "Driver123!", icon: UserCheck, desc: "Alex Carter — assigned jobs" },
  { label: "Other org (isolation demo)", email: "admin2@fleetflow.test", password: "Admin123!", icon: Building2, desc: "NorthPort Cargo — separate tenant" },
];

export function LoginView({ onCreateAccount }: { onCreateAccount?: () => void }) {
  const setSession = useAppStore((s) => s.setSession);
  const setView = useAppStore((s) => s.setView);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard: state updates are async, so a fast double click could slip past `loading`.
  const inFlight = useRef(false);
  // Hint only (never a redirect target): set when /platform sent a signed-out visitor here.
  const fromPlatform = useSearchParams().get("next") === "platform";

  const submit = async (e?: React.FormEvent, creds?: { email: string; password: string }) => {
    e?.preventDefault();
    if (inFlight.current) return;
    const em = creds?.email ?? email;
    const pw = creds?.password ?? password;
    if (!em || !pw) {
      setError("Enter your email and password.");
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<LoginResponse>("/api/auth/login", { email: em, password: pw });
      if (res.kind === "platform") {
        // FleetFlow staff → the platform console (full navigation; keep the spinner).
        window.location.assign(res.redirectTo);
        return;
      }
      setSession(res.user);
      setView(res.user.role === "ADMIN" ? "dashboard" : "driver-jobs");
      if (!res.user.mustChangePassword) toast.success(`Welcome back, ${res.user.name.split(" ")[0]}!`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      if (inFlight.current && !window.location.pathname.startsWith("/platform")) setLoading(false);
      inFlight.current = false;
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <div className="grid flex-1 lg:grid-cols-2">
        {/* Brand / hero panel */}
        <div className="relative hidden overflow-hidden bg-primary lg:block">
          <Image src="/login-hero.png" alt="Courier delivering packages across a city route" fill priority sizes="(max-width: 1024px) 100vw, 50vw" className="object-cover opacity-90" />
          <div className="absolute inset-0 bg-gradient-to-t from-emerald-950/85 via-emerald-900/25 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-10 text-white">
            <div className="mb-4 flex items-center gap-2.5">
              <div className="flex size-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                <Truck className="size-6" />
              </div>
              <span className="text-xl font-semibold tracking-tight">FleetFlow</span>
            </div>
            <h2 className="max-w-md text-2xl font-semibold leading-snug">
              Dispatch smarter. Deliver with proof.
            </h2>
            <p className="mt-2 max-w-md text-sm text-emerald-100/90">
              Assign deliveries to drivers and vehicles, follow every status change, and capture proof of delivery —
              all in one workflow built for small logistics teams.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-xs">
              {["Dispatch board", "Driver portal", "Proof of delivery", "Public tracking", "Reports", "Audit trail"].map((f) => (
                <span key={f} className="rounded-full bg-white/12 px-3 py-1 backdrop-blur">
                  {f}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Login form */}
        <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-md">
            <div className="mb-8 flex items-center gap-2.5 lg:hidden">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Truck className="size-6" />
              </div>
              <div>
                <div className="text-lg font-semibold tracking-tight">FleetFlow</div>
                <div className="text-xs text-muted-foreground">Fleet &amp; Delivery Management</div>
              </div>
            </div>

            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              One sign-in for company admins, dispatchers, drivers and FleetFlow staff — you&apos;ll land in the right workspace.
            </p>
            {fromPlatform ? (
              <p className="mt-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200" role="status">
                Sign in with your FleetFlow staff account to open the platform console.
              </p>
            ) : null}

            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    className="pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="pl-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              {error && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            {onCreateAccount && (
              <div className="mt-6 rounded-xl border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Building2 className="size-4.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">New to FleetFlow?</div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Set up your distribution business in two minutes — free trial, no card needed.
                    </p>
                  </div>
                </div>
                <Button type="button" variant="outline" className="mt-3 w-full" onClick={onCreateAccount} disabled={loading}>
                  Create a company account <ArrowRight className="ml-1 size-4" />
                </Button>
              </div>
            )}

            <div className="mt-8">
              {DEMO_MODE && (
                <>
                  <div className="mb-3 flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs font-medium text-muted-foreground">Demo accounts — one click</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <div className="space-y-2">
                    {DEMO_ACCOUNTS.map((acc) => {
                      const Icon = acc.icon ?? Users;
                      return (
                        <Card
                          key={acc.email}
                          className={cn(
                            "group py-2 transition-colors",
                            loading ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-primary/40 hover:bg-accent/40"
                          )}
                          aria-disabled={loading}
                          onClick={() => {
                            if (!loading) submit(undefined, acc);
                          }}
                        >
                          <CardContent className="flex items-center gap-3 px-3 py-1">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <Icon className="size-4.5" />
                            </div>
                            <div className="min-w-0 flex-1 leading-tight">
                              <div className="text-sm font-medium">{acc.label}</div>
                              <div className="truncate text-xs text-muted-foreground">{acc.email} · {acc.desc}</div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="shrink-0"
                              disabled={loading}
                              onClick={(e) => {
                                e.stopPropagation();
                                submit(undefined, acc);
                              }}
                            >
                              Sign in
                              <span className="sr-only"> as {acc.label}</span>
                            </Button>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </>
              )}
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Customers don&apos;t sign in — they use the secure tracking link sent by the dispatcher.
              </p>
            </div>
          </div>
        </div>
      </div>

      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-1 px-6 py-3 text-xs text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} FleetFlow — Fleet &amp; Delivery Management</span>
          <span>Multi-tenant · Role-based access · Audited</span>
        </div>
      </footer>
    </div>
  );
}
