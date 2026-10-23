"use client";

import { useState } from "react";
import { ExternalLink, KeyRound, LogOut, MoreVertical, UserCheck, UserX, Users } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime, timeAgo } from "@/lib/format";
import type { PlatformOrgDetail, PlatformUserRow, UserAction } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog, EmptyState, fmtNum, RoleBadge, TempPasswordDialog, type TempPasswordInfo, UserStatusBadge } from "../../shared";
import { runUserAction, USER_ACTION_COPY, userActionSuccess } from "../../user-actions";

type Pending = { user: PlatformUserRow; action: UserAction["action"]; seq: number } | null;

const MAX_LISTED = 500;

function UserMenu({ user, onAction }: { user: PlatformUserRow; onAction: (u: PlatformUserRow, a: UserAction["action"]) => void }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-11 text-muted-foreground hover:text-foreground sm:size-8" aria-label={`Actions for ${user.name}`}>
          <MoreVertical className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.active ? (
          <DropdownMenuItem variant="destructive" onSelect={() => onAction(user, "deactivate")}>
            <UserX aria-hidden /> Deactivate
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => onAction(user, "activate")}>
            <UserCheck aria-hidden /> Activate
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onAction(user, "reset-password")}>
          <KeyRound aria-hidden /> Reset password
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction(user, "revoke-sessions")}>
          <LogOut aria-hidden /> Sign out everywhere
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LastSignIn({ at }: { at: string | null }) {
  return at ? (
    <time dateTime={at} title={formatDateTime(at)}>
      {timeAgo(at)}
    </time>
  ) : (
    <span>Never</span>
  );
}

export function UsersTab({ detail, onManageUsers }: { detail: PlatformOrgDetail; onManageUsers: () => void }) {
  const users = detail.users;
  const [pending, setPending] = useState<Pending>(null);
  const [tempPassword, setTempPassword] = useState<TempPasswordInfo | null>(null);
  const ask = (user: PlatformUserRow, action: UserAction["action"]) => setPending((p) => ({ user, action, seq: (p?.seq ?? 0) + 1 }));

  const run = async () => {
    if (!pending) return;
    const { user, action } = pending;
    const res = await runUserAction(user, action);
    if (action === "reset-password" && res.temporaryPassword) {
      setTempPassword({ title: `Temporary password for ${user.name}`, email: user.email, password: res.temporaryPassword });
    } else {
      toast.success(userActionSuccess(user, action));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{fmtNum(detail.stats.users.total)}</span> user{detail.stats.users.total === 1 ? "" : "s"} ·{" "}
          {fmtNum(detail.stats.users.admins)} admin{detail.stats.users.admins === 1 ? "" : "s"}, {fmtNum(detail.stats.users.drivers)} driver
          {detail.stats.users.drivers === 1 ? "" : "s"}
        </p>
        <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={onManageUsers}>
          <ExternalLink aria-hidden /> Manage users
        </Button>
      </div>

      {users.length === 0 ? (
        <EmptyState icon={Users} title="No users yet" description="The company's admins and drivers appear here once they're created." />
      ) : (
        <>
          {/* ≥ sm: table */}
          <div className="hidden overflow-hidden rounded-xl border sm:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Users of {detail.organization.name}</caption>
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Name</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Role</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Last sign-in</th>
                  <th scope="col" className="w-12 px-2 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {users.map((u) => (
                  <tr key={u.id} className="transition-colors hover:bg-muted/30">
                    <td className="max-w-0 px-3 py-2.5">
                      <div className="truncate font-medium">{u.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="px-3 py-2.5">
                      <UserStatusBadge active={u.active} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                      <LastSignIn at={u.lastLoginAt} />
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <UserMenu user={u} onAction={ask} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* < sm: list */}
          <ul className="divide-y divide-border/70 rounded-xl border sm:hidden">
            {users.map((u) => (
              <li key={u.id} className="flex items-start gap-2 py-3 pl-3 pr-1">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{u.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <RoleBadge role={u.role} />
                    <UserStatusBadge active={u.active} />
                    <span>
                      · <LastSignIn at={u.lastLoginAt} />
                    </span>
                  </div>
                </div>
                <UserMenu user={u} onAction={ask} />
              </li>
            ))}
          </ul>
          {users.length >= MAX_LISTED && (
            <p className="text-xs text-muted-foreground">Showing the first {MAX_LISTED}. Use Manage users to search all of them.</p>
          )}
        </>
      )}

      {pending && (
        <ConfirmDialog
          key={pending.seq}
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={USER_ACTION_COPY[pending.action].title(pending.user)}
          description={
            <>
              <p>{USER_ACTION_COPY[pending.action].description}</p>
              <p className="mt-2 text-xs">{pending.user.email}</p>
            </>
          }
          confirmLabel={USER_ACTION_COPY[pending.action].confirm}
          destructive={USER_ACTION_COPY[pending.action].destructive}
          onConfirm={run}
        />
      )}
      <TempPasswordDialog info={tempPassword} onClose={() => setTempPassword(null)} />
    </div>
  );
}

export function UsersSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading users">
      <Skeleton className="h-8 w-1/2" />
      <div className="flex flex-col divide-y rounded-xl border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
