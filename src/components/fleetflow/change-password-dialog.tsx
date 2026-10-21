"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { changePasswordSchema } from "@/lib/validation";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Field = "currentPassword" | "newPassword" | "confirm";
type FieldErrors = Partial<Record<Field, string>>;

/** Client-side check mirroring the server schema, plus the confirmation match. */
export function validatePasswordChange(f: { currentPassword: string; newPassword: string; confirm: string }): FieldErrors {
  const errors: FieldErrors = {};
  const parsed = changePasswordSchema.safeParse({ currentPassword: f.currentPassword, newPassword: f.newPassword });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as Field;
      if (key && !errors[key]) errors[key] = issue.message;
    }
  }
  if (!errors.newPassword && f.confirm !== f.newPassword) errors.confirm = "The passwords don't match";
  return errors;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-rose-600 dark:text-rose-400">
      {message}
    </p>
  );
}

/**
 * Change the signed-in user's password. With `forced` (session.mustChangePassword)
 * it can't be dismissed: the user must replace the temporary password or sign out.
 * Mount with a fresh `key` per open so the form starts empty.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
  forced = false,
  onSignOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forced?: boolean;
  onSignOut?: () => void;
}) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const field = (key: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((errs) => (errs[key] ? { ...errs, [key]: undefined } : errs));
  };
  const errorProps = (id: string, message?: string) => (message ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validatePasswordChange(form);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    try {
      await api.post("/api/auth/password", { currentPassword: form.currentPassword, newPassword: form.newPassword });
      const { session, setSession } = useAppStore.getState();
      if (session) setSession({ ...session, mustChangePassword: false });
      toast.success("Password changed. Other devices have been signed out.");
      onOpenChange(false);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not change your password");
    } finally {
      setSubmitting(false);
    }
  };

  const blockClose = forced || submitting;

  return (
    <Dialog open={open} onOpenChange={(o) => !blockClose && onOpenChange(o)}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!forced}
        onEscapeKeyDown={(e) => blockClose && e.preventDefault()}
        onPointerDownOutside={(e) => blockClose && e.preventDefault()}
        onInteractOutside={(e) => blockClose && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" aria-hidden />
            {forced ? "Choose your own password" : "Change password"}
          </DialogTitle>
          <DialogDescription>
            {forced
              ? "You signed in with a temporary password. Replace it with one only you know before continuing."
              : "Other devices signed in to your account will be signed out."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="cp-current">{forced ? "Temporary password" : "Current password"}</Label>
            <Input
              id="cp-current"
              type="password"
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={field("currentPassword")}
              maxLength={200}
              disabled={submitting}
              {...errorProps("cp-current", errors.currentPassword)}
            />
            <FieldError id="cp-current-error" message={errors.currentPassword} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-new">New password</Label>
            <Input
              id="cp-new"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={form.newPassword}
              onChange={field("newPassword")}
              maxLength={200}
              disabled={submitting}
              {...errorProps("cp-new", errors.newPassword)}
            />
            <FieldError id="cp-new-error" message={errors.newPassword} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-confirm">Confirm new password</Label>
            <Input
              id="cp-confirm"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={field("confirm")}
              maxLength={200}
              disabled={submitting}
              {...errorProps("cp-confirm", errors.confirm)}
            />
            <FieldError id="cp-confirm-error" message={errors.confirm} />
          </div>
          {serverError && (
            <p
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
              role="alert"
            >
              {serverError}
            </p>
          )}
          <DialogFooter>
            {forced ? (
              onSignOut && (
                <Button type="button" variant="outline" onClick={onSignOut} disabled={submitting} className="min-h-11 sm:min-h-9">
                  Sign out
                </Button>
              )
            ) : (
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} className="min-h-11 sm:min-h-9">
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={submitting} className="min-h-11 sm:min-h-9">
              {submitting && <LoaderCircle className="mr-2 size-4 animate-spin" />}
              {submitting ? "Saving…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Shows a just-issued temporary password exactly once, with a copy button.
 * The server never returns it again, so closing this is final.
 */
export function TemporaryPasswordDialog({
  result,
  onClose,
}: {
  result: { name: string; email: string; password: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.password);
      setCopied(true);
      toast.success("Temporary password copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the password and copy it manually");
    }
  };

  return (
    <Dialog open={result !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" aria-hidden />
            Temporary password for {result?.name}
          </DialogTitle>
          <DialogDescription>
            Sign-in email: <span className="font-medium text-foreground">{result?.email}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <code className="min-w-0 flex-1 select-all break-all font-mono text-lg tracking-wider" aria-label="Temporary password">
            {result?.password}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0">
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Share it privately (in person, by phone or a direct message) — not in a group chat. It is shown only once; they&apos;ll be
          asked to choose their own password the first time they sign in.
        </p>
        <DialogFooter>
          <Button type="button" onClick={onClose} className="min-h-11 sm:min-h-9">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ChangePasswordDialog;
