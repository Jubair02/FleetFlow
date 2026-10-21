"use client";

import { CheckCircle2, CircleAlert, KeyRound, ShieldCheck } from "lucide-react";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PlatformSettingsData } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConsole } from "./console-context";
import { usePlatformData } from "./platform-api";
import { ErrorState, PageHeader, UserStatusBadge } from "./shared";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Flag({ ok, label, value, guidance }: { ok: boolean; label: string; value: string; guidance: string }) {
  const Icon = ok ? CheckCircle2 : CircleAlert;
  return (
    <li className="flex gap-3 py-3">
      <Icon className={cn("mt-0.5 size-4 shrink-0", ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-sm tabular-nums text-muted-foreground">{value}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{guidance}</p>
      </div>
    </li>
  );
}

export function SettingsView() {
  const { admin: sessionAdmin, openPasswordDialog } = useConsole();
  const { data, error, reload } = usePlatformData<PlatformSettingsData>("/api/platform/settings");
  const admin = data?.admin ?? sessionAdmin;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" description="Your platform account, the staff with platform access, and environment status." />

      <Card className="gap-2 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">Your account</CardTitle>
          <CardAction>
            <Button size="sm" variant="outline" onClick={openPasswordDialog}>
              <KeyRound aria-hidden /> Change password
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-4">
          <dl className="divide-y">
            <Row label="Name">{admin.name}</Row>
            <Row label="Email">{admin.email}</Row>
            <Row label="Last sign-in">{admin.lastLoginAt ? `${formatDateTime(admin.lastLoginAt)} (${timeAgo(admin.lastLoginAt)})` : "—"}</Row>
            <Row label="Account created">{formatDate(admin.createdAt)}</Row>
          </dl>
        </CardContent>
      </Card>

      {error && !data ? (
        <ErrorState title="Couldn't load platform settings" message={error} onRetry={reload} />
      ) : !data ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="size-4 text-violet-600 dark:text-violet-400" aria-hidden /> Platform admins
              </CardTitle>
              <CardDescription className="text-xs">
                Read-only. Accounts are created via <code className="rounded bg-muted px-1">scripts/create-super-admin.mjs</code> by an operator with server
                access.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Admin</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-4">Last sign-in</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.platformAdmins.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="max-w-56 pl-4">
                        <div className="truncate font-medium">
                          {a.name}
                          {a.id === admin.id && <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{a.email}</div>
                      </TableCell>
                      <TableCell>
                        <UserStatusBadge active={a.active} />
                        {a.mustChangePassword && <div className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">temporary password</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap pr-4 text-muted-foreground">{a.lastLoginAt ? timeAgo(a.lastLoginAt) : "Never"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Environment</CardTitle>
              <CardDescription className="text-xs">Set through server environment variables (see .env.example); changes need a restart.</CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              <ul className="divide-y">
                <Flag
                  ok={data.environment.emailConfigured}
                  label="Email delivery"
                  value={`${data.environment.emailProvider}${data.environment.emailConfigured ? "" : " · not configured"}`}
                  guidance={
                    data.environment.emailConfigured
                      ? "Customer and staff emails are sent through this provider."
                      : "Emails are not being delivered. Configure a provider before onboarding real customers."
                  }
                />
                <Flag
                  ok
                  label="Self-service sign-up"
                  value={data.environment.signupEnabled ? "Enabled" : "Disabled"}
                  guidance={
                    data.environment.signupEnabled
                      ? "Anyone can create a company workspace from the sign-in page."
                      : "Only FleetFlow staff can create organizations (Organizations → Create organization)."
                  }
                />
                <Flag
                  ok={!data.environment.demoMode}
                  label="Demo mode"
                  value={data.environment.demoMode ? "On" : "Off"}
                  guidance={
                    data.environment.demoMode
                      ? "One-click demo accounts are shown on the company sign-in page. Never enable this on an instance with real customer data."
                      : "Demo accounts are hidden — correct for production."
                  }
                />
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
