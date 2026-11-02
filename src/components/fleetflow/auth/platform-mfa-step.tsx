"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, LoaderCircle, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackupCodesPanel } from "@/components/platform/backup-codes";

// ─────────────────────────────────────────────────────────────
// Second sign-in step for FleetFlow staff (mandatory two-factor).
// "verify": authenticator code or a backup code.
// "enroll": scan QR → confirm a code → save the backup codes.
// Uses plain fetch: the company api-client would treat a 401 here as the
// company session ending.
// ─────────────────────────────────────────────────────────────

export type MfaStage = "enroll" | "verify";

interface Setup {
  qrDataUrl: string;
  manualKey: string;
}

class StepError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new StepError(0, "Couldn't reach FleetFlow. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new StepError(res.status, data.error || `Request failed (${res.status})`);
  return data as T;
}

const TIMED_OUT = "Your sign-in timed out. Enter your password again.";

export function PlatformMfaStep({ stage, onCancel }: { stage: MfaStage; onCancel: (message?: string) => void }) {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [backupCodes, setBackupCodes] = useState<{ codes: string[]; email: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const inFlight = useRef(false);
  const setupStarted = useRef(false);

  useEffect(() => {
    if (stage !== "enroll" || setupStarted.current) return;
    setupStarted.current = true;
    post<Setup>("/api/platform/auth/mfa/setup")
      .then(setSetup)
      .catch((e: StepError) => (e.status === 401 ? onCancel(TIMED_OUT) : setSetupError(e.message)));
  }, [stage, onCancel]);

  const cancel = async () => {
    setLeaving(true);
    await post("/api/platform/auth/logout").catch(() => {});
    onCancel();
  };

  const finish = () => {
    setLeaving(true);
    router.replace("/platform"); // server-rendered: re-checks the now complete session
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    const value = code.trim();
    if (!useBackup && !/^\d{6}$/.test(value.replace(/\s/g, ""))) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    if (useBackup && value.replace(/[^a-z0-9]/gi, "").length !== 10) {
      setError("Backup codes look like abcde-fghjk.");
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await post<{ admin: { email: string }; backupCodes?: string[] }>("/api/platform/auth/mfa/verify", { code: value });
      if (res.backupCodes?.length) {
        setBackupCodes({ codes: res.backupCodes, email: res.admin.email });
      } else {
        finish();
      }
    } catch (err) {
      const e = err as StepError;
      if (e.status === 401) onCancel(TIMED_OUT);
      else setError(e.message);
      setCode("");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  // ── after first enrolment: the backup codes, once ──
  if (backupCodes) {
    return (
      <div>
        <ShieldCheck className="size-8 text-primary" aria-hidden />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Save your backup codes</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Two-factor sign-in is on. If you lose your phone, each of these codes signs you in once. They won&apos;t be shown again — store
          them in your password manager or print them.
        </p>
        <div className="mt-5">
          <BackupCodesPanel codes={backupCodes.codes} email={backupCodes.email} />
        </div>
        <label className="mt-5 flex items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I&apos;ve saved my backup codes somewhere safe
        </label>
        <Button type="button" className="mt-5 w-full" disabled={!saved || leaving} onClick={finish}>
          {leaving ? <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden /> : null}
          Continue to the platform console
        </Button>
      </div>
    );
  }

  const enrolling = stage === "enroll";

  return (
    <div>
      <button
        type="button"
        onClick={() => void cancel()}
        disabled={leaving}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to sign in
      </button>

      {enrolling ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Set up two-factor sign-in</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            FleetFlow staff accounts need an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). Scan the code, then
            enter the 6-digit code it shows.
          </p>
          <div className="mt-5 flex flex-col items-center gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-start">
            {setup ? (
              // data: URL generated by the server — nothing for next/image to optimize
              <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={176} height={176} className="size-44 shrink-0 rounded-md bg-white p-1.5" />
            ) : (
              <div className="flex size-44 shrink-0 items-center justify-center rounded-md bg-muted" aria-busy={!setupError}>
                {setupError ? null : <LoaderCircle className="size-6 animate-spin text-muted-foreground" aria-hidden />}
              </div>
            )}
            <div className="min-w-0 text-sm">
              <div className="font-medium">Can&apos;t scan it?</div>
              <p className="mt-0.5 text-xs text-muted-foreground">Add an account manually (time-based) with this key:</p>
              <code className="mt-2 block break-all rounded bg-muted px-2 py-1.5 font-mono text-xs tracking-wide">{setup?.manualKey ?? "…"}</code>
              {setupError && (
                <p className="mt-2 text-xs text-rose-600 dark:text-rose-400" role="alert">
                  {setupError}
                </p>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Two-factor sign-in</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {useBackup ? "Enter one of your backup codes. Each code works only once." : "Enter the 6-digit code from your authenticator app."}
          </p>
        </>
      )}

      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="mfa-code">{useBackup ? "Backup code" : "Authentication code"}</Label>
          <div className="relative">
            {useBackup ? (
              <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            ) : (
              <Smartphone className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            )}
            <Input
              key={useBackup ? "backup" : "totp"}
              id="mfa-code"
              className="pl-9 font-mono tracking-widest"
              {...(useBackup
                ? { autoComplete: "off", placeholder: "abcde-fghjk", maxLength: 16, autoCapitalize: "none", spellCheck: false }
                : { inputMode: "numeric" as const, autoComplete: "one-time-code", pattern: "[0-9]*", placeholder: "123456", maxLength: 7 })}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (error) setError(null);
              }}
              aria-invalid={!!error}
              aria-describedby={error ? "mfa-error" : undefined}
              disabled={submitting || leaving || (enrolling && !setup)}
              autoFocus
            />
          </div>
        </div>

        {error && (
          <p
            id="mfa-error"
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
            role="alert"
          >
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={submitting || leaving || (enrolling && !setup)}>
          {submitting ? <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden /> : null}
          {enrolling ? "Turn on two-factor sign-in" : "Verify"}
        </Button>
      </form>

      {!enrolling && (
        <button
          type="button"
          className="mt-4 text-sm font-medium text-primary hover:underline"
          onClick={() => {
            setUseBackup((b) => !b);
            setCode("");
            setError(null);
          }}
        >
          {useBackup ? "Use your authenticator app instead" : "Lost your phone? Use a backup code"}
        </button>
      )}
      <p className="mt-6 text-xs text-muted-foreground">
        No phone and no backup codes? Ask an operator with server access to run <code className="rounded bg-muted px-1">scripts/reset-super-admin-2fa.mjs</code>.
      </p>
    </div>
  );
}
