"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, KeyRound, LoaderCircle, Lock, Truck, TriangleAlert } from "lucide-react";
import { resetPasswordWithTokenSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Field = "newPassword" | "confirm";
type FieldErrors = Partial<Record<Field, string>>;

/** Same rules as the server (resetPasswordWithTokenSchema ⇐ change-password rules) plus the confirmation. */
function validate(token: string, newPassword: string, confirm: string): FieldErrors {
  const errors: FieldErrors = {};
  const parsed = resetPasswordWithTokenSchema.safeParse({ token, newPassword });
  if (!parsed.success) {
    const issue = parsed.error.issues.find((i) => i.path[0] === "newPassword");
    if (issue) errors.newPassword = issue.message;
  }
  if (!errors.newPassword && confirm !== newPassword) errors.confirm = "The passwords don't match";
  return errors;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Truck className="size-6" aria-hidden />
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight">FleetFlow</div>
            <div className="text-xs text-muted-foreground">Fleet &amp; Delivery Management</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/** `token` is null when the link is missing, used, expired or unknown (checked on the server). */
export function ResetPasswordView({ token }: { token: string | null }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(token === null);
  const inFlight = useRef(false);

  // Keep the one-time token out of the address bar and browser history.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || inFlight.current) return;
    const found = validate(token, newPassword, confirm);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length > 0) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setDone(true);
      } else if (res.status === 400 && data.error?.includes("expired")) {
        setExpired(true);
      } else {
        setServerError(data.error || `Request failed (${res.status})`);
      }
    } catch {
      setServerError("Couldn't reach FleetFlow. Check your connection and try again.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Shell>
        <div className="rounded-xl border bg-card p-6">
          <CheckCircle2 className="size-8 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <h1 className="mt-3 text-xl font-semibold tracking-tight">Password changed</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            For your security you&apos;ve been signed out on every device. Sign in with your new password.
          </p>
          <Button asChild className="mt-5 w-full">
            <Link href="/">Go to sign in</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  if (expired || !token) {
    return (
      <Shell>
        <div className="rounded-xl border bg-card p-6">
          <TriangleAlert className="size-8 text-amber-600 dark:text-amber-400" aria-hidden />
          <h1 className="mt-3 text-xl font-semibold tracking-tight">This link can&apos;t be used</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Password reset links work once and expire after an hour. Request a new one with &ldquo;Forgot password?&rdquo; on the sign-in page.
          </p>
          <Button asChild className="mt-5 w-full">
            <Link href="/">Back to sign in</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Use at least 8 characters. Every device signed in to your account will be signed out.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="new-password">New password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              className="pl-9"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                if (errors.newPassword) setErrors((x) => ({ ...x, newPassword: undefined }));
              }}
              aria-invalid={!!errors.newPassword}
              aria-describedby={errors.newPassword ? "new-password-error" : undefined}
              disabled={submitting}
              autoFocus
            />
          </div>
          {errors.newPassword && (
            <p id="new-password-error" className="text-xs text-rose-600 dark:text-rose-400">
              {errors.newPassword}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <div className="relative">
            <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              className="pl-9"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                if (errors.confirm) setErrors((x) => ({ ...x, confirm: undefined }));
              }}
              aria-invalid={!!errors.confirm}
              aria-describedby={errors.confirm ? "confirm-password-error" : undefined}
              disabled={submitting}
            />
          </div>
          {errors.confirm && (
            <p id="confirm-password-error" className="text-xs text-rose-600 dark:text-rose-400">
              {errors.confirm}
            </p>
          )}
        </div>

        {serverError && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert">
            {serverError}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden /> : null}
          {submitting ? "Saving…" : "Set new password"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </Shell>
  );
}
