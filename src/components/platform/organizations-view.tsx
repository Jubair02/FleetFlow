"use client";

import { useState } from "react";
import { BadgeCheck, Building2, CreditCard, Download, LoaderCircle, Plus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { downloadCsv } from "@/lib/format";
import type { CreateOrgResult, PlatformOrgList, PlatformOrgRow, PlatformPlansData } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConsole } from "./console-context";
import { bumpPlatformData, errorMessage, platformApi, useDebounced, usePlatformData, withQuery } from "./platform-api";
import { EMAIL_RE, EmptyState, ErrorState, errorProps, FieldError, fmtNum, ServerError, TempPasswordDialog, type TempPasswordInfo } from "./shared";
import { DeleteOrgDialog, ReactivateOrgDialog, SuspendOrgDialog } from "./organizations/org-action-dialogs";
import { ChangePlanDialog } from "./organizations/dialog/change-plan-dialog";
import { EditOrgDialog } from "./organizations/dialog/edit-org-dialog";
import { DEFAULT_PAGE_SIZE, exportFilename, orgCsvRows, rowNumber, statusFilterParams, toIsoDay, type PageSize } from "./organizations/org-list-utils";
import { KpiSkeleton, OrgKpiCard, type RowActionHandlers } from "./organizations/org-parts";
import { OrgCardList, OrgPagination, OrgResultsSkeleton, OrgTable } from "./organizations/org-results";
import { EMPTY_FILTERS, hasActiveFilters, OrgToolbar, type OrgFilters } from "./organizations/org-toolbar";

const LIST_URL = "/api/platform/organizations";

type ActionKind = "suspend" | "reactivate" | "edit" | "plan" | "delete";

export function OrganizationsView() {
  const { openOrg } = useConsole();
  const [filters, setFilters] = useState<OrgFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  /** Selected rows by id — kept across pages so "Export selected" can span them. */
  const [selected, setSelected] = useState<Map<string, PlatformOrgRow>>(() => new Map());
  const [exporting, setExporting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSeq, setCreateSeq] = useState(0);
  const [tempPassword, setTempPassword] = useState<TempPasswordInfo | null>(null);
  const [action, setAction] = useState<{ kind: ActionKind | null; org: PlatformOrgRow | null; seq: number }>({ kind: null, org: null, seq: 0 });
  const debouncedSearch = useDebounced(filters.search.trim(), 300);

  const { status, subscription } = statusFilterParams(filters.status);
  const from = filters.range?.from ? toIsoDay(filters.range.from) : null;
  const listParams = {
    search: debouncedSearch,
    status,
    subscription,
    plan: filters.plan === "all" ? null : filters.plan,
    from,
    to: filters.range?.to ? toIsoDay(filters.range.to) : from,
  };
  const url = withQuery(LIST_URL, { ...listParams, page, pageSize });
  const { data, loading, error, reload } = usePlatformData<PlatformOrgList>(url);
  const { data: plansData, error: plansError } = usePlatformData<PlatformPlansData>("/api/platform/plans");
  const filtered = hasActiveFilters(filters);
  const rows = data?.items ?? [];
  const summary = data?.summary ?? null;
  /** Rows are numbered across pages: page 2 of 20 starts at #21. */
  const offset = data ? rowNumber(data.page, data.pageSize, 0) - 1 : 0;

  const updateFilters = (patch: Partial<OrgFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
    setSelected(new Map());
  };

  // ── Selection ──
  const selectedOnPage = rows.filter((r) => selected.has(r.id)).length;
  const headerState = selectedOnPage === 0 ? false : selectedOnPage === rows.length ? true : ("indeterminate" as const);
  const toggle = (row: PlatformOrgRow, checked: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (checked) next.set(row.id, row);
      else next.delete(row.id);
      return next;
    });
  const toggleAll = (checked: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      // A partial page ("indeterminate") selects the rest; a full page clears it.
      const selectAll = checked && selectedOnPage < rows.length;
      for (const r of rows) {
        if (selectAll) next.set(r.id, r);
        else next.delete(r.id);
      }
      return next;
    });

  // ── Export ──
  const download = (list: PlatformOrgRow[]) => {
    downloadCsv(exportFilename(), orgCsvRows(list));
    toast.success(`Exported ${fmtNum(list.length)} organization${list.length === 1 ? "" : "s"}`);
  };
  const exportAll = async () => {
    setExporting(true);
    try {
      const res = await platformApi.get<PlatformOrgList>(withQuery(LIST_URL, { ...listParams, export: 1 }));
      if (!res.items.length) {
        toast.info("No organizations match these filters — nothing to export");
        return;
      }
      download(res.items);
      if (res.total > res.items.length) {
        toast.warning(`Only the first ${fmtNum(res.items.length)} of ${fmtNum(res.total)} organizations were exported — narrow the filters to export the rest`);
      }
    } catch (e) {
      toast.error(errorMessage(e, "Export failed — try again"));
    } finally {
      setExporting(false);
    }
  };

  const act = (kind: ActionKind) => (row: PlatformOrgRow) => setAction((a) => ({ kind, org: row, seq: a.seq + 1 }));
  const handlers: RowActionHandlers = {
    onView: (row, tab) => openOrg(row.id, tab),
    onEdit: act("edit"),
    onChangePlan: act("plan"),
    onSuspend: act("suspend"),
    onReactivate: act("reactivate"),
    onDelete: act("delete"),
  };
  const closeAction = (o: boolean) => !o && setAction((a) => ({ ...a, kind: null }));
  /** A deleted organization can't stay selected for "Export selected". The list itself refreshes via bumpPlatformData(). */
  const onOrgDeleted = (id: string | undefined) =>
    id &&
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">Organizations</h2>
          <p className="mt-1 max-w-prose text-sm text-pretty text-muted-foreground">
            Manage all organizations, their subscriptions and usage statistics
          </p>
        </div>
        <Button
          className="h-11 w-full shrink-0 shadow-sm sm:h-9 sm:w-auto"
          onClick={() => {
            setCreateSeq((n) => n + 1);
            setCreateOpen(true);
          }}
        >
          <Plus aria-hidden /> Add Organization
        </Button>
      </header>

      <section aria-label="Organization statistics" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {summary ? (
          <>
            <OrgKpiCard
              icon={Building2}
              label="Total organizations"
              value={summary.totalOrganizations}
              delta={summary.newOrganizationsThisWeek}
              tint="bg-violet-500/10 text-violet-600 dark:text-violet-400"
            />
            <OrgKpiCard
              icon={BadgeCheck}
              label="Active organizations"
              value={summary.activeOrganizations}
              delta={summary.newActiveThisWeek}
              tint="bg-primary/10 text-primary"
            />
            <OrgKpiCard
              icon={Users}
              label="Total users"
              value={summary.totalUsers}
              delta={summary.newUsersThisWeek}
              tint="bg-sky-500/10 text-sky-600 dark:text-sky-400"
            />
            <OrgKpiCard
              icon={CreditCard}
              label="Active subscriptions"
              value={summary.activeSubscriptions}
              hint={`of ${fmtNum(summary.totalOrganizations)} organizations`}
              tint="bg-teal-500/10 text-teal-600 dark:text-teal-400"
            />
          </>
        ) : error && !data ? null : (
          Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)
        )}
      </section>

      <OrgToolbar
        filters={filters}
        onChange={updateFilters}
        plans={plansData}
        plansError={plansError}
        onExport={exportAll}
        exporting={exporting}
        canExport={!!data && data.total > 0}
      />

      {selected.size > 0 && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2 text-sm"
          role="status"
          aria-live="polite"
        >
          <span className="font-medium tabular-nums">{fmtNum(selected.size)} selected</span>
          <span className="text-muted-foreground" aria-hidden>
            ·
          </span>
          <Button variant="ghost" size="sm" className="h-11 px-2 text-primary hover:text-primary lg:h-8" onClick={() => download([...selected.values()])}>
            <Download aria-hidden /> Export selected
          </Button>
          <Button variant="ghost" size="sm" className="h-11 px-2 text-muted-foreground lg:h-8" onClick={() => setSelected(new Map())}>
            <X aria-hidden /> Clear
          </Button>
        </div>
      )}

      <Card className="gap-0 rounded-xl border-border/70 py-0 shadow-sm">
        {error && !data ? (
          <div className="p-4">
            <ErrorState title="Couldn't load organizations" message={error} onRetry={reload} />
          </div>
        ) : !data ? (
          <OrgResultsSkeleton rows={Math.min(pageSize, 8)} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={data.total > 0 ? "This page is empty" : filtered ? "No organizations match these filters" : "No organizations yet"}
            description={
              data.total > 0
                ? "The list changed since this page loaded."
                : filtered
                  ? "Try a different search, plan, status or date range."
                  : "Add the first organization to onboard a customer."
            }
            action={
              data.total > 0 ? (
                <Button variant="outline" size="sm" className="mt-2" onClick={() => setPage(1)}>
                  Go to the first page
                </Button>
              ) : filtered ? (
                <Button variant="outline" size="sm" className="mt-2" onClick={() => updateFilters(EMPTY_FILTERS)}>
                  <X aria-hidden /> Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {error && (
              <div className="p-3">
                <ErrorState title="Showing the last loaded page" message={error} onRetry={reload} />
              </div>
            )}
            <OrgTable rows={rows} loading={loading} isSelected={(id) => selected.has(id)} onToggle={toggle} headerState={headerState} onToggleAll={toggleAll} handlers={handlers} offset={offset} />
            <OrgCardList rows={rows} loading={loading} isSelected={(id) => selected.has(id)} onToggle={toggle} headerState={headerState} onToggleAll={toggleAll} handlers={handlers} offset={offset} />
          </>
        )}
        {data && data.total > 0 && (
          <OrgPagination
            page={data.page}
            pageCount={data.pageCount}
            pageSize={pageSize}
            total={data.total}
            onPage={setPage}
            onPageSize={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            disabled={loading}
          />
        )}
        {loading && data && (
          <span className="sr-only" role="status">
            Loading organizations…
          </span>
        )}
      </Card>

      <SuspendOrgDialog key={`s-${action.seq}`} open={action.kind === "suspend"} org={action.org} onOpenChange={closeAction} />
      <ReactivateOrgDialog key={`r-${action.seq}`} open={action.kind === "reactivate"} org={action.org} onOpenChange={closeAction} />
      <DeleteOrgDialog
        key={`d-${action.seq}`}
        open={action.kind === "delete"}
        org={action.org}
        onOpenChange={closeAction}
        onSuspendInstead={() => action.org && act("suspend")(action.org)}
        onDeleted={() => onOrgDeleted(action.org?.id)}
      />
      {/* These load the organization's detail themselves (usage, limits, profile). */}
      <EditOrgDialog key={`e-${action.seq}`} open={action.kind === "edit"} orgId={action.org?.id ?? null} onOpenChange={closeAction} />
      <ChangePlanDialog key={`p-${action.seq}`} open={action.kind === "plan"} orgId={action.org?.id ?? null} onOpenChange={closeAction} />

      <CreateOrgDialog
        key={createSeq}
        open={createOpen}
        onOpenChange={setCreateOpen}
        plans={plansData}
        plansError={plansError}
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

export function validateCreateOrg(f: Record<CreateField, string>, assignablePlanCodes: string[]): CreateErrors {
  const e: CreateErrors = {};
  const company = f.companyName.trim();
  if (company.length < 2) e.companyName = "Company name must be at least 2 characters";
  else if (company.length > 120) e.companyName = "Company name must be 120 characters or fewer";
  const name = f.adminName.trim();
  if (name.length < 2) e.adminName = "Name must be at least 2 characters";
  else if (name.length > 120) e.adminName = "Name must be 120 characters or fewer";
  const email = f.adminEmail.trim();
  if (!EMAIL_RE.test(email) || email.length > 254) e.adminEmail = "Enter a valid email";
  if (!assignablePlanCodes.includes(f.plan)) e.plan = "Choose an active plan";
  const phone = f.phone.trim();
  if (phone && (phone.length < 6 || phone.length > 30)) e.phone = "Phone must be 6–30 characters";
  return e;
}

function CreateOrgDialog({
  open,
  onOpenChange,
  plans,
  plansError,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  plans: PlatformPlansData | null;
  plansError: string | null;
  onCreated: (res: CreateOrgResult, companyName: string) => void;
}) {
  // Only active plans can be newly assigned. "" = use the default plan once the list has loaded.
  const assignable = (plans?.plans ?? []).filter((p) => p.active);
  const defaultCode = assignable.find((p) => p.isDefault)?.code ?? assignable[0]?.code ?? "";
  const [form, setForm] = useState<Record<CreateField, string>>({ companyName: "", adminName: "", adminEmail: "", plan: "", phone: "" });
  const planValue = form.plan || defaultCode;
  const [errors, setErrors] = useState<CreateErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: CreateField, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((errs) => (errs[key] ? { ...errs, [key]: undefined } : errs));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateCreateOrg({ ...form, plan: planValue }, assignable.map((p) => p.code));
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
        plan: planValue,
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
              <Select value={planValue} onValueChange={(v) => set("plan", v)} disabled={submitting || assignable.length === 0}>
                <SelectTrigger id="co-plan" className="w-full" {...errorProps("co-plan", errors.plan)}>
                  <SelectValue placeholder={plans ? "No active plans" : plansError ? "Couldn't load plans" : "Loading plans…"} />
                </SelectTrigger>
                <SelectContent>
                  {assignable.map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.name}
                      {p.isDefault ? " · default" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError id="co-plan-error" message={errors.plan ?? (plansError && !plans ? plansError : undefined)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-phone">
                Phone <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="co-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={30} disabled={submitting} {...errorProps("co-phone", errors.phone)} />
              <FieldError id="co-phone-error" message={errors.phone} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            The plan&apos;s current list price is recorded. Change the billing cycle or record a negotiated price later with Change plan.
          </p>
          <ServerError message={serverError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !planValue}>
              {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
              {submitting ? "Creating…" : "Create organization"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
