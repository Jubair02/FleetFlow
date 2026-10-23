"use client";

import { useState } from "react";
import { AlertTriangle, Ban, LoaderCircle, PlayCircle, Trash2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { OrgDeletePreview, OrgDeletionCounts } from "@/lib/platform-types";
import { usePlatformData } from "../platform-api";
import { errorProps, ErrorState, FieldError, fmtNum, ServerError } from "../shared";
import { deleteOrg, orgDeletePreviewUrl, patchOrg } from "./org-api";
import { SHEET_ON_PHONE } from "./dialog/org-dialog-utils";

// Suspend / reactivate / delete confirmations, used by the list ⋮ menu and the
// organization dialog. Same PATCH bodies as before; every rule is enforced server-side.

const SUSPEND_REASON_MIN = 3;
const SUSPEND_REASON_MAX = 300;

type OrgRefLike = { id: string; name: string } | null;

function useSubmit(onDone: () => void) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await work();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action failed");
    } finally {
      setSubmitting(false);
    }
  };
  return { submitting, error, run };
}

function ConfirmHeader({ tone, title, icon, children }: { tone: "rose" | "emerald"; title: string; icon?: LucideIcon; children: React.ReactNode }) {
  const Icon = icon ?? (tone === "rose" ? AlertTriangle : PlayCircle);
  return (
    <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:gap-4 sm:text-left">
      <span
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-full",
          tone === "rose" ? "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400" : "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
        )}
        aria-hidden
      >
        <Icon className="size-6" />
      </span>
      <div className="min-w-0 space-y-1.5 sm:pt-1">
        <DialogTitle className="text-lg leading-tight">{title}</DialogTitle>
        <DialogDescription className="text-sm text-pretty">{children}</DialogDescription>
      </div>
    </div>
  );
}

export function SuspendOrgDialog({ open, org, onOpenChange }: { open: boolean; org: OrgRefLike; onOpenChange: (o: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const { submitting, error, run } = useSubmit(() => onOpenChange(false));
  const trimmed = reason.trim();
  const invalid = trimmed.length < SUSPEND_REASON_MIN ? `Enter a reason (at least ${SUSPEND_REASON_MIN} characters) — it is kept in the audit log` : undefined;
  const shownError = touched ? invalid : undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid || !org) return;
    void run(async () => {
      await patchOrg(org.id, { action: "suspend", reason: trimmed });
      toast.success(`${org.name} suspended`);
    });
  };

  return (
    <Dialog open={open && org !== null} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className={cn("sm:max-w-md", SHEET_ON_PHONE)}>
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <ConfirmHeader tone="rose" title="Suspend organization">
            Are you sure you want to suspend <span className="font-semibold text-foreground">{org?.name}</span>?
          </ConfirmHeader>
          <ul className="space-y-1.5 rounded-lg border border-rose-200/70 bg-rose-50/60 px-4 py-3 text-sm text-rose-900 marker:text-rose-400 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-200 [&>li]:ml-4 [&>li]:list-disc">
            <li>All staff and drivers are signed out and can&apos;t sign in or create deliveries.</li>
            <li>Existing data is preserved — nothing is deleted.</li>
            <li>Customer tracking links keep working.</li>
            <li>You can reactivate the organization at any time.</li>
          </ul>
          <div className="space-y-1.5">
            <Label htmlFor="suspend-reason">
              Reason <span className="font-normal text-muted-foreground">(required)</span>
            </Label>
            <Textarea
              id="suspend-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              maxLength={SUSPEND_REASON_MAX}
              rows={3}
              placeholder="e.g. Unpaid invoice for September; requested by owner"
              disabled={submitting}
              {...errorProps("suspend-reason", shownError)}
            />
            <div className="flex justify-between gap-2">
              <FieldError id="suspend-reason-error" message={shownError} />
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                {reason.length}/{SUSPEND_REASON_MAX}
              </span>
            </div>
          </div>
          <ServerError message={error} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" className="h-11 sm:h-9" disabled={submitting || (touched && !!invalid)}>
              {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
              Suspend
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReactivateOrgDialog({ open, org, onOpenChange }: { open: boolean; org: OrgRefLike; onOpenChange: (o: boolean) => void }) {
  const { submitting, error, run } = useSubmit(() => onOpenChange(false));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    void run(async () => {
      await patchOrg(org.id, { action: "reactivate" });
      toast.success(`${org.name} reactivated`);
    });
  };
  return (
    <Dialog open={open && org !== null} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className={cn("sm:max-w-md", SHEET_ON_PHONE)}>
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <ConfirmHeader tone="emerald" title="Reactivate organization">
            Reactivate <span className="font-semibold text-foreground">{org?.name}</span>?
          </ConfirmHeader>
          <ul className="space-y-1.5 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground [&>li]:ml-4 [&>li]:list-disc">
            <li>Staff and drivers can sign in again straight away.</li>
            <li>Their data is exactly as it was when the organization was suspended.</li>
            <li>The suspension stays in the audit log.</li>
          </ul>
          <ServerError message={error} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-9" disabled={submitting}>
              {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
              Reactivate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const DELETE_COUNT_ITEMS: { key: keyof OrgDeletionCounts; label: string }[] = [
  { key: "users", label: "Users" },
  { key: "drivers", label: "Drivers" },
  { key: "vehicles", label: "Vehicles" },
  { key: "deliveries", label: "Deliveries" },
  { key: "proofOfDelivery", label: "Delivery photos" },
  { key: "auditLogs", label: "Audit entries" },
];

/**
 * Permanent deletion. Only a SUSPENDED organization can be deleted, confirmed by
 * typing its exact name; the server re-checks both inside a locked transaction.
 */
export function DeleteOrgDialog({
  open,
  org,
  onOpenChange,
  onSuspendInstead,
  onDeleted,
}: {
  open: boolean;
  org: OrgRefLike;
  onOpenChange: (o: boolean) => void;
  /** Close this dialog and open the existing suspend confirmation. */
  onSuspendInstead: () => void;
  /** Called after a successful deletion (e.g. to close the organization dialog). */
  onDeleted?: () => void;
}) {
  const visible = open && org !== null;
  const preview = usePlatformData<OrgDeletePreview>(visible && org ? orgDeletePreviewUrl(org.id) : null);
  const [confirm, setConfirm] = useState("");
  const { submitting, error, run } = useSubmit(() => {
    onOpenChange(false);
    onDeleted?.();
  });

  const data = preview.data;
  const name = data?.name ?? org?.name ?? "";
  const suspended = data?.status === "SUSPENDED";
  const matches = !!data && confirm === data.name;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || !data || !suspended || !matches) return;
    void run(async () => {
      await deleteOrg(org.id, confirm);
      toast.success(`${data.name} was permanently deleted`);
    });
  };

  return (
    <Dialog open={visible} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className={cn("sm:max-w-lg", SHEET_ON_PHONE)}>
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate aria-busy={submitting || preview.loading}>
          <ConfirmHeader tone="rose" icon={Trash2} title="Delete organization">
            Are you sure you want to delete <span className="font-semibold break-words text-foreground">{name}</span>?
          </ConfirmHeader>

          <div className="space-y-3 rounded-lg border border-rose-200/70 bg-rose-50/60 px-4 py-3 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-200">
            <p className="font-medium text-pretty">
              This action cannot be undone. All data related to this organization will be permanently removed.
            </p>
            {data ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3" aria-label="Data that will be deleted">
                {DELETE_COUNT_ITEMS.map(({ key, label }) => (
                  <div key={key} className="min-w-0">
                    <dt className="truncate text-xs text-rose-800/80 dark:text-rose-300/80">{label}</dt>
                    <dd className="text-base font-semibold tabular-nums">{fmtNum(data.counts[key])}</dd>
                  </div>
                ))}
              </dl>
            ) : preview.error ? null : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3" aria-hidden>
                {DELETE_COUNT_ITEMS.map(({ key }) => (
                  <div key={key} className="space-y-1.5">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-5 w-10" />
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-rose-800/80 dark:text-rose-300/80">The platform audit log keeps a record of this deletion.</p>
          </div>

          {preview.error && !data && <ErrorState title="Couldn't load what will be deleted" message={preview.error} onRetry={preview.reload} />}

          {data && !suspended && (
            <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-pretty text-muted-foreground" role="status">
              <span className="font-medium text-foreground">Suspend this organization first.</span> Only a suspended organization can be deleted, so its
              staff and drivers are signed out before any data is removed.
            </p>
          )}

          {data && suspended && (
            <div className="space-y-1.5">
              <Label htmlFor="delete-confirm-name" className="block leading-snug">
                Type <span className="font-semibold break-all select-all">{data.name}</span> to confirm
              </Label>
              <Input
                id="delete-confirm-name"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                required
                className="h-11 sm:h-9"
                disabled={submitting}
                aria-describedby="delete-confirm-hint"
              />
              <p id="delete-confirm-hint" className="text-xs text-muted-foreground">
                The name must match exactly, including capital letters and spaces.
              </p>
            </div>
          )}

          <ServerError message={error} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            {data && !suspended ? (
              <Button type="button" variant="destructive" className="h-11 sm:h-9" onClick={onSuspendInstead}>
                <Ban aria-hidden /> Suspend instead
              </Button>
            ) : (
              <Button type="submit" variant="destructive" className="h-11 sm:h-9" disabled={submitting || !suspended || !matches}>
                {submitting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                {submitting ? "Deleting…" : "Delete permanently"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
