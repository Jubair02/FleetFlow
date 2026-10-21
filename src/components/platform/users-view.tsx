"use client";

import { useState } from "react";
import { Building2, ChevronsUpDown, KeyRound, LogOut, MoreHorizontal, Search, UserCheck, UserX, Users, X } from "lucide-react";
import { toast } from "sonner";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import type { Paged, PlatformOrgRow, PlatformUserRow, UserAction } from "@/lib/platform-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConsole, type OrgRef } from "./console-context";
import { bumpPlatformData, platformApi, useDebounced, usePlatformData, withQuery } from "./platform-api";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  OrgStatusBadge,
  PageHeader,
  PaginationBar,
  RoleBadge,
  TableSkeleton,
  TempPasswordDialog,
  type TempPasswordInfo,
  UserStatusBadge,
} from "./shared";

type PendingAction = { user: PlatformUserRow; action: UserAction["action"] } | null;

const ACTION_COPY: Record<UserAction["action"], { title: (u: PlatformUserRow) => string; description: string; confirm: string; destructive?: boolean }> = {
  deactivate: {
    title: (u) => `Deactivate ${u.name}?`,
    description:
      "They are signed out everywhere and can't sign in until reactivated. Their deliveries, history and audit trail are kept. Their organization's admins can see the change.",
    confirm: "Deactivate",
    destructive: true,
  },
  activate: {
    title: (u) => `Reactivate ${u.name}?`,
    description: "They can sign in again with their existing password. Plan limits for the organization may block reactivation if it is at its limit.",
    confirm: "Reactivate",
  },
  "reset-password": {
    title: (u) => `Reset password for ${u.name}?`,
    description:
      "Their current password stops working and they are signed out everywhere. A temporary password is shown to you once — share it privately; they must choose a new one at next sign-in.",
    confirm: "Reset password",
    destructive: true,
  },
  "revoke-sessions": {
    title: (u) => `Sign ${u.name} out everywhere?`,
    description: "Ends every active session on all devices. Their password is unchanged — they can sign in again straight away.",
    confirm: "Sign out everywhere",
  },
};

export function UsersView() {
  const { usersOrgFilter, setUsersOrgFilter, openOrg } = useConsole();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<PendingAction>(null);
  const [pendingSeq, setPendingSeq] = useState(0);
  const [tempPassword, setTempPassword] = useState<TempPasswordInfo | null>(null);
  const debouncedSearch = useDebounced(search.trim(), 300);

  const url = withQuery("/api/platform/users", {
    search: debouncedSearch,
    role: role === "all" ? null : role,
    status: status === "all" ? null : status,
    organizationId: usersOrgFilter?.id,
    page,
  });
  const { data, loading, error, reload } = usePlatformData<Paged<PlatformUserRow>>(url);
  const filtered = !!debouncedSearch || role !== "all" || status !== "all" || !!usersOrgFilter;

  const ask = (user: PlatformUserRow, action: UserAction["action"]) => {
    setPendingSeq((n) => n + 1);
    setPending({ user, action });
  };

  const runAction = async () => {
    if (!pending) return;
    const { user, action } = pending;
    const res = await platformApi.patch<{ success: boolean; temporaryPassword?: string }>(`/api/platform/users/${encodeURIComponent(user.id)}`, {
      action,
    } satisfies UserAction);
    bumpPlatformData();
    if (action === "reset-password" && res.temporaryPassword) {
      setTempPassword({ title: `Temporary password for ${user.name}`, email: user.email, password: res.temporaryPassword });
    } else {
      toast.success(
        action === "deactivate"
          ? `${user.name} deactivated`
          : action === "activate"
            ? `${user.name} reactivated`
            : action === "revoke-sessions"
              ? `${user.name} signed out everywhere`
              : `Password reset for ${user.name}`
      );
    }
  };

  return (
    <div>
      <PageHeader title="Users" description="Company admins and drivers across every organization. Roles are managed by each company." />

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-col gap-2 border-b p-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by name or email…"
              className="pl-9"
              aria-label="Search users"
              maxLength={100}
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <OrgPicker
              value={usersOrgFilter}
              onChange={(o) => {
                setUsersOrgFilter(o);
                setPage(1);
              }}
            />
            <Select
              value={role}
              onValueChange={(v) => {
                setRole(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-36" aria-label="Filter by role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="ADMIN">Admins</SelectItem>
                <SelectItem value="DRIVER">Drivers</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Deactivated</SelectItem>
              </SelectContent>
            </Select>
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start sm:self-center"
                onClick={() => {
                  setSearch("");
                  setRole("all");
                  setStatus("all");
                  setUsersOrgFilter(null);
                  setPage(1);
                }}
              >
                <X aria-hidden /> Clear
              </Button>
            )}
          </div>
        </div>

        {error && !data ? (
          <div className="p-4">
            <ErrorState title="Couldn't load users" message={error} onRetry={reload} />
          </div>
        ) : !data ? (
          <TableSkeleton />
        ) : data.items.length === 0 ? (
          <EmptyState icon={Users} title={filtered ? "No users match these filters" : "No users yet"} description={filtered ? "Try a different search or clear the filters." : undefined} />
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
                  <TableHead>User</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="max-w-64">
                      <div className="truncate font-medium">{u.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell className="max-w-56">
                      <button
                        type="button"
                        onClick={() => openOrg(u.organization.id)}
                        className="block max-w-full truncate text-left text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        {u.organization.name}
                      </button>
                      {u.organization.status === "SUSPENDED" && <OrgStatusBadge status="SUSPENDED" />}
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={u.role} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <UserStatusBadge active={u.active} />
                        {u.mustChangePassword && (
                          <Badge variant="outline" className="whitespace-nowrap border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                            Temp password
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground" title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : undefined}>
                      {u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Never"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${u.name}`}>
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{u.email}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {u.active ? (
                            <DropdownMenuItem onSelect={() => ask(u, "deactivate")} className="cursor-pointer text-rose-700 dark:text-rose-400">
                              <UserX className="mr-2 size-4" aria-hidden /> Deactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => ask(u, "activate")} className="cursor-pointer">
                              <UserCheck className="mr-2 size-4" aria-hidden /> Reactivate
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => ask(u, "reset-password")} className="cursor-pointer">
                            <KeyRound className="mr-2 size-4" aria-hidden /> Reset password
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => ask(u, "revoke-sessions")} className="cursor-pointer">
                            <LogOut className="mr-2 size-4" aria-hidden /> Sign out everywhere
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
        {data && data.total > 0 && (
          <PaginationBar page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} noun="users" onPage={setPage} disabled={loading} />
        )}
      </Card>

      {pending && (
        <ConfirmDialog
          key={pendingSeq}
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={ACTION_COPY[pending.action].title(pending.user)}
          description={
            <>
              <p>{ACTION_COPY[pending.action].description}</p>
              <p className="mt-2 text-xs">
                {pending.user.email} · {pending.user.organization.name}
              </p>
            </>
          }
          confirmLabel={ACTION_COPY[pending.action].confirm}
          destructive={ACTION_COPY[pending.action].destructive}
          onConfirm={runAction}
        />
      )}
      <TempPasswordDialog info={tempPassword} onClose={() => setTempPassword(null)} />
    </div>
  );
}

/** Searchable organization filter (queries /api/platform/organizations). */
export function OrgPicker({ value, onChange }: { value: OrgRef | null; onChange: (org: OrgRef | null) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 250);
  const { data, loading, error } = usePlatformData<Paged<PlatformOrgRow>>(open ? withQuery("/api/platform/organizations", { search: debounced, page: 1 }) : null);

  if (value) {
    return (
      <div className="flex h-9 max-w-full items-center gap-1.5 rounded-md border bg-primary/5 pl-3 pr-1 text-sm sm:max-w-60">
        <Building2 className="size-3.5 shrink-0 text-primary" aria-hidden />
        <span className="truncate font-medium" title={value.name}>
          {value.name}
        </span>
        <Button variant="ghost" size="icon" className="ml-auto size-7" onClick={() => onChange(null)} aria-label={`Remove organization filter ${value.name}`}>
          <X aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal sm:w-52" aria-label="Filter by organization">
          <span className="flex items-center gap-2 text-muted-foreground">
            <Building2 aria-hidden /> All organizations
          </span>
          <ChevronsUpDown className="opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b p-2">
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search organizations…" aria-label="Search organizations" className="h-8" />
        </div>
        <div className="max-h-64 overflow-y-auto overscroll-contain p-1" role="listbox" aria-label="Organizations">
          {error ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">{error}</div>
          ) : loading && !data ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">Loading…</div>
          ) : !data || data.items.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">No organizations found.</div>
          ) : (
            data.items.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onChange({ id: o.id, name: o.name });
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="truncate">{o.name}</span>
                {o.status === "SUSPENDED" && <span className="shrink-0 text-[11px] text-rose-600 dark:text-rose-400">Suspended</span>}
              </button>
            ))
          )}
          {data && data.total > data.items.length && <div className="px-2 py-1.5 text-[11px] text-muted-foreground">Type to narrow {data.total} organizations…</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
