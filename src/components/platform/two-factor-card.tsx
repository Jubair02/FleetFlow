"use client";

import { useState } from "react";
import { LoaderCircle, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";
import type { PlatformTwoFactorStatus } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackupCodesPanel } from "./backup-codes";
import { platformApi } from "./platform-api";

/**
 * Two-factor status for the signed-in super admin. Two-factor is mandatory,
 * so there is no "turn off" — only regenerating backup codes (which needs a
 * current authenticator code). A lost phone is handled by an operator with
 * scripts/reset-super-admin-2fa.mjs.
 */
export function TwoFactorCard({ status, email, onChanged }: { status: PlatformTwoFactorStatus | null; email: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [seq, setSeq] = useState(0);
  const low = !!status && status.enabled && status.backupCodesRemaining <= 3;

  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          {status?.enabled ? (
            <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          ) : (
            <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
          )}
          Two-factor sign-in
        </CardTitle>
        <CardDescription className="text-xs">Required for every FleetFlow staff account: password plus a code from your authenticator app.</CardDescription>
        {status?.enabled && (
          <CardAction>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSeq((n) => n + 1);
                setOpen(true);
              }}
            >
              <RefreshCw aria-hidden /> Regenerate backup codes
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="px-4">
        {!status ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <dl className="divide-y text-sm">
            <div className="grid grid-cols-[8rem_1fr] gap-2 py-2">
              <dt className="text-muted-foreground">Status</dt>
              <dd>{status.enabled ? <span className="font-medium text-emerald-700 dark:text-emerald-400">On</span> : "Not set up"}</dd>
            </div>
            {status.enabledAt && (
              <div className="grid grid-cols-[8rem_1fr] gap-2 py-2">
                <dt className="text-muted-foreground">Set up</dt>
                <dd>{formatDateTime(status.enabledAt)}</dd>
              </div>
            )}
            <div className="grid grid-cols-[8rem_1fr] gap-2 py-2">
              <dt className="text-muted-foreground">Backup codes</dt>
              <dd className={low ? "text-amber-700 dark:text-amber-400" : undefined}>
                {status.backupCodesRemaining} unused{low ? " — regenerate them soon" : ""}
              </dd>
            </div>
          </dl>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Lost your phone and backup codes? An operator with server access runs{" "}
          <code className="rounded bg-muted px-1">scripts/reset-super-admin-2fa.mjs</code>; you then set it up again at your next sign-in.
        </p>
      </CardContent>
      <RegenerateDialog key={seq} open={open} onOpenChange={setOpen} email={email} onDone={onChanged} />
    </Card>
  );
}

function RegenerateDialog({
  open,
  onOpenChange,
  email,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  onDone: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.replace(/\s/g, ""))) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await platformApi.post<{ backupCodes: string[] }>("/api/platform/auth/mfa/backup-codes", { code });
      setCodes(res.backupCodes);
      toast.success("New backup codes generated — the old ones no longer work");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not regenerate the backup codes");
      setCode("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{codes ? "Your new backup codes" : "Regenerate backup codes"}</DialogTitle>
          <DialogDescription>
            {codes
              ? "Save them now — they won't be shown again. Each code works once."
              : "Your current backup codes stop working. Confirm with a code from your authenticator app."}
          </DialogDescription>
        </DialogHeader>
        {codes ? (
          <>
            <BackupCodesPanel codes={codes} email={email} />
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                I&apos;ve saved them
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="regen-code">Authentication code</Label>
              <Input
                id="regen-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={7}
                placeholder="123456"
                className="font-mono tracking-widest"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  if (error) setError(null);
                }}
                aria-invalid={!!error}
                aria-describedby={error ? "regen-error" : undefined}
                disabled={submitting}
                autoFocus
              />
              {error && (
                <p id="regen-error" className="text-xs text-rose-600 dark:text-rose-400" role="alert">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                Generate new codes
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
