"use client";

import { useState } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import type { PlatformAdminInfo } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { platformApi } from "./platform-api";
import { errorProps, FieldError, ServerError } from "./shared";

export const PLATFORM_MIN_PASSWORD = 12;

type Field = "currentPassword" | "newPassword" | "confirm";
type FieldErrors = Partial<Record<Field, string>>;

export function validatePlatformPassword(f: Record<Field, string>): FieldErrors {
  const errors: FieldErrors = {};
  if (!f.currentPassword) errors.currentPassword = "Enter your current password";
  if (f.newPassword.length < PLATFORM_MIN_PASSWORD) errors.newPassword = `Use at least ${PLATFORM_MIN_PASSWORD} characters`;
  else if (f.newPassword.length > 200) errors.newPassword = "Password must be 200 characters or fewer";
  else if (f.newPassword === f.currentPassword) errors.newPassword = "Choose a password different from the current one";
  if (!errors.newPassword && f.confirm !== f.newPassword) errors.confirm = "The passwords don't match";
  return errors;
}

/**
 * Change the platform admin's password. `forced` (temporary password) can't be
 * dismissed — the only way out is "Sign out". Mount with a fresh key per open.
 */
export function PlatformPasswordDialog({
  open,
  onOpenChange,
  forced = false,
  onChanged,
  onSignOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forced?: boolean;
  onChanged: (admin: PlatformAdminInfo) => void;
  onSignOut: () => void;
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validatePlatformPassword(form);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    try {
      const res = await platformApi.post<{ admin: PlatformAdminInfo }>("/api/platform/auth/password", {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      toast.success("Password changed");
      onChanged(res.admin);
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
            {forced ? "Set your own password" : "Change password"}
          </DialogTitle>
          <DialogDescription>
            {forced
              ? "Your account was created with a temporary password. Replace it before using the platform console."
              : `Use at least ${PLATFORM_MIN_PASSWORD} characters. A password manager is recommended.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="pp-current">{forced ? "Temporary password" : "Current password"}</Label>
            <Input
              id="pp-current"
              type="password"
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={field("currentPassword")}
              maxLength={200}
              disabled={submitting}
              {...errorProps("pp-current", errors.currentPassword)}
            />
            <FieldError id="pp-current-error" message={errors.currentPassword} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp-new">New password</Label>
            <Input
              id="pp-new"
              type="password"
              autoComplete="new-password"
              placeholder={`At least ${PLATFORM_MIN_PASSWORD} characters`}
              value={form.newPassword}
              onChange={field("newPassword")}
              maxLength={200}
              disabled={submitting}
              {...errorProps("pp-new", errors.newPassword)}
            />
            <FieldError id="pp-new-error" message={errors.newPassword} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp-confirm">Confirm new password</Label>
            <Input
              id="pp-confirm"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={field("confirm")}
              maxLength={200}
              disabled={submitting}
              {...errorProps("pp-confirm", errors.confirm)}
            />
            <FieldError id="pp-confirm-error" message={errors.confirm} />
          </div>
          <ServerError message={serverError} />
          <DialogFooter>
            {forced ? (
              <Button type="button" variant="outline" onClick={onSignOut} disabled={submitting}>
                Sign out
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
              {submitting ? "Saving…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
