"use client";

import { useRef, useState } from "react";
import { ArrowLeft, LoaderCircle, Mail, MailCheck } from "lucide-react";
import { forgotPasswordSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * "Forgot password?" on the sign-in screen. The server answers the same way
 * whether or not the account exists, so the confirmation is always generic.
 */
export function ForgotPasswordForm({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email");
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: parsed.data.email }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (res.ok) setSentMessage(data.message ?? "If an account exists for that email, we've sent a reset link.");
      else setError(data.error || `Request failed (${res.status})`);
    } catch {
      setError("Couldn't reach FleetFlow. Check your connection and try again.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Back to sign in
      </button>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>

      {sentMessage ? (
        <div className="mt-6 rounded-xl border bg-card p-5" role="status">
          <MailCheck className="size-7 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <p className="mt-3 text-sm">{sentMessage}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            The link works once and expires in an hour. No email? Drivers and staff can also ask their company admin to reset the password.
          </p>
          <Button type="button" variant="outline" className="mt-4 w-full" onClick={onBack}>
            Back to sign in
          </Button>
        </div>
      ) : (
        <>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Enter the email you sign in with and we&apos;ll send you a link to choose a new password.
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  className="pl-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                  autoFocus
                />
              </div>
            </div>
            {error && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden /> : null}
              {submitting ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
