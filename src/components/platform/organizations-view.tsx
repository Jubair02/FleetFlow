"use client";

import { useState } from "react";
import { Building2, LoaderCircle, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { formatDate, timeAgo } from "@/lib/format";
import { getPlan, type PlanCode } from "@/lib/plan-catalog";
import type { CreateOrgResult, Paged, PlatformOrgRow } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConsole } from "./console-context";
import { bumpPlatformData, platformApi, useDebounced, usePlatformData, withQuery } from "./platform-api";
import {
  CopyIdButton,
  EMAIL_RE,
  EmptyState,
  ErrorState,
  errorProps,
  FieldError,
  fmtNum,
  OrgStatusBadge,
  PageHeader,
  PaginationBar,
  PLAN_CODES,
  PlanBadge,
  ServerError,
  SubscriptionBadge,
  TableSkeleton,
  TempPasswordDialog,
  type TempPasswordInfo,
} from "./shared";

export function OrganizationsView() {
  const { openOrg } = useConsole();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [plan, setPlan] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSeq, setCreateSeq] = useState(0);
  const [tempPassword, setTempPassword] = useState<TempPasswordInfo | null>(null);
  const debouncedSearch = useDebounced(search.trim(), 300);

  const url = withQuery("/api/platform/organizations", {
    search: debouncedSearch,
    status: status === "all" ? null : status,
    plan: plan === "all" ? null : plan,
    page,
  });
  const { data, loading, error, reload } = usePlatformData<Paged<PlatformOrgRow>>(url);
  const filtered = !!debouncedSearch || status !== "all" || plan !== "all";

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Organizations"
        description="Every company workspace on FleetFlow."
        actions={
          <Button
            onClick={() => {
              setCreateSeq((n) => n + 1);
              setCreateOpen(true);
            }}
          >
            <Plus aria-hidden /> Create organization
          </Button>
        }
      />

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => resetPage(setSearch)(e.target.value)}
              placeholder="Search by name or ID…"
              className="pl-9"
              aria-label="Search organizations"
              maxLength={100}
            />
          </div>
          <Select value={status} onValueChange={resetPage(setStatus)}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="SUSPENDED">Suspended</SelectItem>
            </SelectContent>
          </Select>
          <Select value={plan} onValueChange={resetPage(setPlan)}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Filter by plan">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plans</SelectItem>
              {PLAN_CODES.map((c) => (
                <SelectItem key={c} value={c}>
                  {getPlan(c).name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setStatus("all");
                setPlan("all");
                setPage(1);
              }}
            >
              <X aria-hidden /> Clear
            </Button>
          )}
        </div>

        {error && !data ? (
          <div className="p-4">
            <ErrorState title="Couldn't load organizations" message={error} onRetry={reload} />
          </div>
        ) : !data ? (
          <TableSkeleton />
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={filtered ? "No organizations match these filters" : "No organizations yet"}
            description={filtered ? "Try a different search or clear the filters." : "Create the first organization to onboard a customer."}
          />
        ) : (
          <>
            {error && (
              <div className="p-3">
                <ErrorState title="Showing the last loaded page" message={error} onRetry={reload} />
              </div>
            )}
            <Table className={loading ? "opacity-60 transition-opacity" : undefined} aria-busy={loading}>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead className="text-right">Admins</TableHead>
                  <TableHead className="text-right">Drivers</TableHead>
                  <TableHead className="text-right">Vehicles</TableHead>
                  <TableHead className="text-right">Deliveries</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => openOrg(o.id)}>
                    <TableCell className="max-w-64">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openOrg(o.id);
                        }}
                        className="block max-w-full truncate text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        {o.name}
                      </button>
                      <CopyIdButton id={o.id} label="organization ID" />
                    </TableCell>
                    <TableCell>
                      <OrgStatusBadge status={o.status} />
                    </TableCell>
                    <TableCell>
                      <PlanBadge plan={o.plan} />
                    </TableCell>
                    <TableCell>
                      <SubscriptionBadge status={o.subscriptionStatus} />
                      {o.paidUntil && <div className="mt-0.5 text-[11px] text-muted-foreground">until {formatDate(o.paidUntil)}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(o.counts.admins)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(o.counts.drivers)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(o.counts.vehicles)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(o.counts.deliveries)}
                      <div className="text-[11px] text-muted-foreground">{fmtNum(o.counts.deliveriesThisMonth)} this month</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(o.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{o.lastActivityAt ? timeAgo(o.lastActivityAt) : "Never"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
        {data && data.total > 0 && (
          <PaginationBar page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} noun="organizations" onPage={setPage} disabled={loading} />
        )}
      </Card>

      <CreateOrgDialog
        key={createSeq}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(res, companyName) => {
          setTempPassword({
            title: `${companyName} is ready`,
            email: res.adminEmail,
            password: res.temporaryPassword,
            note: "Send the company admin this temporary password. They'll be asked to choose their own at first sign-in.",
          });
          bumpPlatformData();
        }}
      />
      <TempPasswordDialog info={tempPassword} onClose={() => setTempPassword(null)} />
    </div>
  );
}

// ── Create organization ──────────────────────────────────────

type CreateField = "companyName" | "adminName" | "adminEmail" | "plan" | "phone";
type CreateErrors = Partial<Record<CreateField, string>>;

export function validateCreateOrg(f: Record<CreateField, string>): CreateErrors {
  const e: CreateErrors = {};
  const company = f.companyName.trim();
  if (company.length < 2) e.companyName = "Company name must be at least 2 characters";
  else if (company.length > 120) e.companyName = "Company name must be 120 characters or fewer";
  const name = f.adminName.trim();
  if (name.length < 2) e.adminName = "Name must be at least 2 characters";
  else if (name.length > 120) e.adminName = "Name must be 120 characters or fewer";
  const email = f.adminEmail.trim();
  if (!EMAIL_RE.test(email) || email.length > 254) e.adminEmail = "Enter a valid email";
  if (!PLAN_CODES.includes(f.plan as PlanCode)) e.plan = "Choose a plan";
  const phone = f.phone.trim();
  if (phone && (phone.length < 6 || phone.length > 30)) e.phone = "Phone must be 6–30 characters";
  return e;
}

function CreateOrgDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (res: CreateOrgResult, companyName: string) => void;
}) {
  const [form, setForm] = useState<Record<CreateField, string>>({ companyName: "", adminName: "", adminEmail: "", plan: "trial", phone: "" });
  const [errors, setErrors] = useState<CreateErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: CreateField, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((errs) => (errs[key] ? { ...errs, [key]: undefined } : errs));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateCreateOrg(form);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length) return;
    setSubmitting(true);
    try {
      const companyName = form.companyName.trim();
      const res = await platformApi.post<CreateOrgResult>("/api/platform/organizations", {
        companyName,
        adminName: form.adminName.trim(),
        adminEmail: form.adminEmail.trim().toLowerCase(),
        plan: form.plan,
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      });
      toast.success(`${companyName} created`);
      onOpenChange(false);
      onCreated(res, companyName);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not create the organization");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            Creates the company workspace and its first admin account with a one-time temporary password.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="co-company">Company name</Label>
            <Input id="co-company" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} maxLength={120} disabled={submitting} {...errorProps("co-company", errors.companyName)} />
            <FieldError id="co-company-error" message={errors.companyName} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="co-admin">Admin name</Label>
              <Input id="co-admin" value={form.adminName} onChange={(e) => set("adminName", e.target.value)} maxLength={120} disabled={submitting} {...errorProps("co-admin", errors.adminName)} />
              <FieldError id="co-admin-error" message={errors.adminName} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-email">Admin email</Label>
              <Input
                id="co-email"
                type="email"
                autoComplete="off"
                value={form.adminEmail}
                onChange={(e) => set("adminEmail", e.target.value)}
                maxLength={254}
                disabled={submitting}
                {...errorProps("co-email", errors.adminEmail)}
              />
              <FieldError id="co-email-error" message={errors.adminEmail} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="co-plan">Plan</Label>
              <Select value={form.plan} onValueChange={(v) => set("plan", v)} disabled={submitting}>
                <SelectTrigger id="co-plan" className="w-full" {...errorProps("co-plan", errors.plan)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_CODES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {getPlan(c).name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError id="co-plan-error" message={errors.plan} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-phone">
                Phone <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="co-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={30} disabled={submitting} {...errorProps("co-phone", errors.phone)} />
              <FieldError id="co-phone-error" message={errors.phone} />
            </div>
          </div>
          <ServerError message={serverError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
              {submitting ? "Creating…" : "Create organization"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
