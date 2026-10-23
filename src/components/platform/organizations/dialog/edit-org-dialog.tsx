"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { isValidTimezone } from "@/lib/timezone";
import type { PlatformOrgDetail } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Callout, errorProps, FieldError, ServerError } from "../../shared";
import { patchOrg } from "../org-api";
import { OrgFormDialog, type FormControls } from "./org-form-dialog";
import { changedProfile, profileFormFrom, timezoneOptions, validateProfile, type ProfileErrors, type ProfileField, type ProfileForm } from "./org-dialog-utils";

/** Edit the company profile ("update-profile": only changed fields are sent and written). */
export function EditOrgDialog({
  open,
  onOpenChange,
  orgId,
  detail,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgId: string | null;
  detail?: PlatformOrgDetail | null;
}) {
  return (
    <OrgFormDialog open={open} onOpenChange={onOpenChange} orgId={orgId} detail={detail} title="Edit organization" className="sm:max-w-xl">
      {(d, controls) => <EditOrgForm detail={d} controls={controls} />}
    </OrgFormDialog>
  );
}

function EditOrgForm({ detail, controls }: { detail: PlatformOrgDetail; controls: FormControls }) {
  const org = detail.organization;
  const [initial] = useState<ProfileForm>(() => profileFormFrom(org));
  const [form, setForm] = useState<ProfileForm>(initial);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const changes = changedProfile(initial, form);
  const dirty = Object.keys(changes).length > 0;

  const set = (key: ProfileField, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateProfile(form, isValidTimezone);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length || !dirty) return;
    setSubmitting(true);
    controls.setBusy(true);
    try {
      await patchOrg(org.id, { action: "update-profile", ...changes });
      toast.success(`${changes.name ?? org.name} updated`);
      controls.setBusy(false);
      controls.close();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not save the organization");
      controls.setBusy(false);
    } finally {
      setSubmitting(false);
    }
  };

  const field = (key: ProfileField) => ({
    id: `edit-org-${key}`,
    value: form[key],
    disabled: submitting,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, e.target.value),
    ...errorProps(`edit-org-${key}`, errors[key]),
  });
  const inputCls = "h-11 sm:h-9";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Edit organization</DialogTitle>
        <DialogDescription>Company details for {org.name}. The company&apos;s admins can see that FleetFlow support changed them.</DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="edit-org-name">Company name</Label>
        <Input {...field("name")} className={inputCls} maxLength={120} autoComplete="organization" />
        <FieldError id="edit-org-name-error" message={errors.name} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="edit-org-contactEmail">
            Contact email <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input {...field("contactEmail")} type="email" className={inputCls} maxLength={254} autoComplete="off" />
          <FieldError id="edit-org-contactEmail-error" message={errors.contactEmail} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-org-phone">
            Phone <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input {...field("phone")} type="tel" className={inputCls} maxLength={30} autoComplete="off" />
          <FieldError id="edit-org-phone-error" message={errors.phone} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-org-address">
          Address <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea {...field("address")} rows={2} maxLength={300} />
        <FieldError id="edit-org-address-error" message={errors.address} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-org-defaultPickupAddress">
          Default pickup address <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea {...field("defaultPickupAddress")} rows={2} maxLength={300} />
        <FieldError id="edit-org-defaultPickupAddress-error" message={errors.defaultPickupAddress} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-org-timezone">Timezone</Label>
        <Select value={form.timezone} onValueChange={(v) => set("timezone", v)} disabled={submitting}>
          <SelectTrigger id="edit-org-timezone" className="h-11 w-full sm:h-9" {...errorProps("edit-org-timezone", errors.timezone)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timezoneOptions(initial.timezone).map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError id="edit-org-timezone-error" message={errors.timezone} />
        <p className="text-[11px] text-muted-foreground">Used for CSV import dates and the monthly delivery limit window.</p>
      </div>

      <Callout tone="zinc">Only changed fields are saved. The company&apos;s audit log records which fields changed — not their values.</Callout>
      <ServerError message={serverError} />
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={controls.close} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 sm:h-9" disabled={submitting || !dirty}>
          {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
          Save changes
        </Button>
      </DialogFooter>
    </form>
  );
}
