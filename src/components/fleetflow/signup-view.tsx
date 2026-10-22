"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowLeft, Building2, LoaderCircle, Lock, Mail, Phone, Truck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { signupSchema } from "@/lib/validation";
import { useAppStore } from "@/store/app-store";
import type { SessionUser } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PricingTable } from "@/components/fleetflow/pricing-table";

type Field = "companyName" | "name" | "email" | "password" | "phone";
type FieldErrors = Partial<Record<Field, string>>;

const EMPTY = { companyName: "", name: "", email: "", password: "", phone: "" };

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-rose-600 dark:text-rose-400">
      {message}
    </p>
  );
}

/** Client-side mirror of the server schema — one message per field. */
function validate(form: typeof EMPTY): FieldErrors {
  const parsed = signupSchema.safeParse(form);
  if (parsed.success) return {};
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as Field;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

export function SignupView({ onSignIn }: { onSignIn: () => void }) {
  const setSession = useAppStore((s) => s.setSession);
  const setView = useAppStore((s) => s.setView);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ enabled: boolean }>("/api/auth/signup")
      .then((r) => !cancelled && setEnabled(r.enabled))
      .catch(() => !cancelled && setEnabled(true)); // the POST will still enforce it
    return () => {
      cancelled = true;
    };
  }, []);

  const field = (key: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((errs) => (errs[key] ? { ...errs, [key]: undefined } : errs));
  };

  const errorProps = (id: string, message?: string) => (message ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    const found = validate(form);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length > 0) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const res = await api.post<{ user: SessionUser }>("/api/auth/signup", {
        companyName: form.companyName.trim(),
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim(),
      });
      setSession(res.user);
      setView("dashboard");
      onSignIn(); // so signing out later lands on the sign-in screen
      toast.success(`Welcome to FleetFlow, ${res.user.name.split(" ")[0]}! Let's get your first delivery out.`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Sign-up failed");
    } finally {
      inFlight.current = false;
      setLoading(false);
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
            <h2 className="max-w-md text-2xl font-semibold leading-snug">From order to signed delivery — on one screen.</h2>
            <p className="mt-2 max-w-md text-sm text-emerald-100/90">
              Built for distributors delivering to shops every day: add your vans and drivers, create or import today&apos;s orders,
              dispatch them, and get proof of delivery back from the driver&apos;s phone.
            </p>
            <ol className="mt-6 space-y-1.5 text-sm text-emerald-50/95">
              {["Create your company account", "Add a vehicle and a driver", "Create or import your first delivery", "Assign it and follow it live"].map(
                (step, i) => (
                  <li key={step} className="flex items-center gap-2.5">
                    <span className="flex size-5 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold">{i + 1}</span>
                    {step}
                  </li>
                )
              )}
            </ol>
          </div>
        </div>

        {/* Sign-up form */}
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

            <Button variant="ghost" size="sm" className="-ml-2 mb-4 text-muted-foreground" onClick={onSignIn} disabled={loading}>
              <ArrowLeft className="mr-1 size-4" /> Back to sign in
            </Button>

            <h1 className="text-2xl font-semibold tracking-tight">Create your company account</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              You&apos;ll be the first admin. Start on a free trial — upgrade only when it works for you.
            </p>

            {enabled === false ? (
              <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" role="status">
                Self-service sign-up is closed on this server. Contact FleetFlow to open an account for your company.
              </p>
            ) : (
              <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="signup-company">Company name</Label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="signup-company"
                      autoComplete="organization"
                      placeholder="e.g. Rahman Traders"
                      className="pl-9"
                      maxLength={120}
                      value={form.companyName}
                      onChange={field("companyName")}
                      disabled={loading}
                      {...errorProps("signup-company", errors.companyName)}
                    />
                  </div>
                  <FieldError id="signup-company-error" message={errors.companyName} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Your name</Label>
                  <div className="relative">
                    <UserRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="signup-name"
                      autoComplete="name"
                      placeholder="e.g. Karim Rahman"
                      className="pl-9"
                      maxLength={120}
                      value={form.name}
                      onChange={field("name")}
                      disabled={loading}
                      {...errorProps("signup-name", errors.name)}
                    />
                  </div>
                  <FieldError id="signup-name-error" message={errors.name} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Work email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="signup-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@company.com"
                      className="pl-9"
                      maxLength={254}
                      value={form.email}
                      onChange={field("email")}
                      disabled={loading}
                      {...errorProps("signup-email", errors.email)}
                    />
                  </div>
                  <FieldError id="signup-email-error" message={errors.email} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="signup-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      className="pl-9"
                      maxLength={200}
                      value={form.password}
                      onChange={field("password")}
                      disabled={loading}
                      {...errorProps("signup-password", errors.password)}
                    />
                  </div>
                  <FieldError id="signup-password-error" message={errors.password} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-phone">
                    Phone <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="signup-phone"
                      type="tel"
                      autoComplete="tel"
                      placeholder="+880 1XXX-XXXXXX"
                      className="pl-9"
                      maxLength={30}
                      value={form.phone}
                      onChange={field("phone")}
                      disabled={loading}
                      {...errorProps("signup-phone", errors.phone)}
                    />
                  </div>
                  <FieldError id="signup-phone-error" message={errors.phone} />
                </div>

                {serverError && (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert">
                    {serverError}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={loading || enabled === null}>
                  {loading ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                  {loading ? "Creating your account…" : "Create company account"}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Already have an account?{" "}
                  <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={onSignIn} disabled={loading}>
                    Sign in
                  </button>
                </p>
              </form>
            )}
          </div>
        </div>
      </div>

      <section aria-labelledby="signup-plans-heading" className="border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
          <h2 id="signup-plans-heading" className="text-lg font-semibold tracking-tight">
            Plans
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Switch to the plan that fits whenever you&apos;re ready — there&apos;s nothing to pay online.</p>
          <div className="mt-6">
            <PricingTable />
          </div>
        </div>
      </section>

      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-1 px-6 py-3 text-xs text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} FleetFlow — Fleet &amp; Delivery Management</span>
          <span>Multi-tenant · Role-based access · Audited</span>
        </div>
      </footer>
    </div>
  );
}

export default SignupView;
