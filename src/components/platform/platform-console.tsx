"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Building2,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  ScrollText,
  Settings,
  Sun,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import type { PlatformAdminInfo } from "@/lib/platform-types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConsoleContext, type ConsoleContextValue, type OrgRef, type PlatformView } from "./console-context";
import { onPlatformUnauthorized, platformApi } from "./platform-api";
import { PlatformLogin } from "./platform-login";
import { PlatformPasswordDialog } from "./password-dialog";
import { PlatformBadge } from "./shared";
import { OverviewView } from "./overview-view";
import { OrganizationsView } from "./organizations-view";
import { OrgDetailSheet } from "./org-detail";
import { UsersView } from "./users-view";
import { PlansView } from "./plans-view";
import { AnalyticsView } from "./analytics-view";
import { AuditView } from "./audit-view";
import { SettingsView } from "./settings-view";

const NAV: { section: string; items: { view: PlatformView; label: string; icon: LucideIcon }[] }[] = [
  {
    section: "Platform",
    items: [
      { view: "overview", label: "Overview", icon: LayoutDashboard },
      { view: "organizations", label: "Organizations", icon: Building2 },
      { view: "users", label: "Users", icon: Users },
    ],
  },
  {
    section: "Business",
    items: [
      { view: "plans", label: "Plans", icon: CreditCard },
      { view: "analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    section: "Governance",
    items: [
      { view: "audit", label: "Audit Logs", icon: ScrollText },
      { view: "settings", label: "Settings", icon: Settings },
    ],
  },
];

const VIEW_TITLES: Record<PlatformView, string> = {
  overview: "Overview",
  organizations: "Organizations",
  users: "Users",
  plans: "Plans",
  analytics: "Analytics",
  audit: "Audit Logs",
  settings: "Settings",
};

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Truck className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 leading-tight">
        <div className="font-semibold tracking-tight text-sidebar-foreground">FleetFlow</div>
        <PlatformBadge className="mt-0.5" />
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      <Sun className="hidden size-5 dark:block" aria-hidden />
      <Moon className="size-5 dark:hidden" aria-hidden />
    </Button>
  );
}

function SidebarContent({
  admin,
  view,
  onSelect,
  onSignOut,
  signingOut,
}: {
  admin: PlatformAdminInfo;
  view: PlatformView;
  onSelect: (v: PlatformView) => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Logo />
      <div className="flex-1 overflow-y-auto">
        <nav className="flex flex-col gap-5" aria-label="Platform navigation">
          {NAV.map((group) => (
            <div key={group.section}>
              <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{group.section}</div>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = view === item.view;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.view}
                      type="button"
                      onClick={() => onSelect(item.view)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                      )}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>
      <div className="flex flex-col gap-3">
        <p className="rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-[11px] leading-snug text-violet-800 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300">
          You are in the FleetFlow platform console — actions here affect customer organizations and are audited.
        </p>
        <div className="flex items-center justify-between gap-2 rounded-xl border bg-card p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar className="size-8 border">
              <AvatarFallback className="bg-violet-500/10 text-xs font-semibold text-violet-700 dark:text-violet-300">{initials(admin.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-medium">{admin.name}</div>
              <div className="truncate text-[11px] text-muted-foreground">Platform admin</div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onSignOut} disabled={signingOut} title="Sign out" aria-label="Sign out">
            <LogOut className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Signed-in console. Holds its own auth state so a 401 returns to the console sign-in, never the company app. */
export function PlatformConsole({ initialAdmin }: { initialAdmin: PlatformAdminInfo }) {
  const [admin, setAdmin] = useState<PlatformAdminInfo | null>(initialAdmin);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);

  useEffect(
    () =>
      onPlatformUnauthorized(() => {
        setLoginNotice("Your platform session has ended — please sign in again.");
        setAdmin(null);
      }),
    []
  );

  if (!admin) {
    return (
      <PlatformLogin
        notice={loginNotice}
        onSignedIn={(a) => {
          setLoginNotice(null);
          setAdmin(a);
        }}
      />
    );
  }

  return (
    <ConsoleShell
      key={admin.id}
      admin={admin}
      onAdminChange={setAdmin}
      onSignedOut={() => {
        setLoginNotice("You have signed out.");
        setAdmin(null);
      }}
    />
  );
}

function ConsoleShell({
  admin,
  onAdminChange,
  onSignedOut,
}: {
  admin: PlatformAdminInfo;
  onAdminChange: (a: PlatformAdminInfo) => void;
  onSignedOut: () => void;
}) {
  const [view, setViewState] = useState<PlatformView>("overview");
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [usersOrgFilter, setUsersOrgFilter] = useState<OrgRef | null>(null);
  const [auditOrgFilter, setAuditOrgFilter] = useState<OrgRef | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSeq, setPasswordSeq] = useState(0);
  const forced = admin.mustChangePassword;

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await platformApi.post("/api/platform/auth/logout");
    } catch {
      /* the cookie may already be gone — sign out locally regardless */
    }
    setSigningOut(false);
    onSignedOut();
  }, [onSignedOut]);

  const setView = useCallback((v: PlatformView) => {
    setViewState(v);
    setMobileNavOpen(false);
  }, []);

  const ctx = useMemo<ConsoleContextValue>(
    () => ({
      admin,
      view,
      setView,
      openOrg: (id) => setSelectedOrgId(id),
      showOrgUsers: (org) => {
        setUsersOrgFilter(org);
        setSelectedOrgId(null);
        setViewState("users");
      },
      showOrgAudit: (org) => {
        setAuditOrgFilter(org);
        setSelectedOrgId(null);
        setViewState("audit");
      },
      usersOrgFilter,
      setUsersOrgFilter,
      auditOrgFilter,
      setAuditOrgFilter,
      openPasswordDialog: () => {
        setPasswordSeq((n) => n + 1);
        setPasswordOpen(true);
      },
    }),
    [admin, view, setView, usersOrgFilter, auditOrgFilter]
  );

  return (
    <ConsoleContext.Provider value={ctx}>
      <div className="flex min-h-screen w-full bg-background">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
          <SidebarContent admin={admin} view={view} onSelect={setView} onSignOut={() => void signOut()} signingOut={signingOut} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Thin violet rule marks every console page as platform-level, not a company workspace. */}
          <div className="h-0.5 w-full bg-violet-500/70" aria-hidden />
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:px-6">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                  <Menu className="size-5" aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 bg-sidebar p-0">
                <SheetTitle className="sr-only">Platform navigation</SheetTitle>
                <SidebarContent admin={admin} view={view} onSelect={setView} onSignOut={() => void signOut()} signingOut={signingOut} />
              </SheetContent>
            </Sheet>

            <h1 className="truncate text-base font-semibold tracking-tight md:text-lg">{VIEW_TITLES[view]}</h1>
            <PlatformBadge className="md:hidden" />
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="ml-1 rounded-full outline-none ring-primary/40 focus-visible:ring-2" aria-label="Account menu">
                    <Avatar className="size-8 border">
                      <AvatarFallback className="bg-violet-500/10 text-xs font-semibold text-violet-700 dark:text-violet-300">{initials(admin.name)}</AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel>
                    <div className="text-sm font-semibold">{admin.name}</div>
                    <div className="text-xs font-normal text-muted-foreground">{admin.email}</div>
                    <PlatformBadge className="mt-1.5" />
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="cursor-pointer" onSelect={() => setView("settings")}>
                    <Settings className="mr-2 size-4" aria-hidden /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer" onSelect={ctx.openPasswordDialog} disabled={forced}>
                    <KeyRound className="mr-2 size-4" aria-hidden /> Change password
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="cursor-pointer" disabled={signingOut} onSelect={() => void signOut()}>
                    <LogOut className="mr-2 size-4" aria-hidden /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main className="flex-1 px-4 py-5 md:px-6 md:py-6">
            {forced ? (
              <div className="mx-auto mt-16 max-w-md text-center text-sm text-muted-foreground">
                Set your own password to continue using the platform console.
              </div>
            ) : (
              <>
                {view === "overview" && <OverviewView />}
                {view === "organizations" && <OrganizationsView />}
                {view === "users" && <UsersView />}
                {view === "plans" && <PlansView />}
                {view === "analytics" && <AnalyticsView />}
                {view === "audit" && <AuditView />}
                {view === "settings" && <SettingsView />}
              </>
            )}
          </main>

          <footer className="mt-auto border-t bg-background">
            <div className="flex flex-col items-center justify-between gap-1 px-6 py-3 text-xs text-muted-foreground sm:flex-row">
              <span>© {new Date().getFullYear()} FleetFlow — Platform operations</span>
              <span>Signed in as {admin.email}</span>
            </div>
          </footer>
        </div>

        {!forced && <OrgDetailSheet orgId={selectedOrgId} onClose={() => setSelectedOrgId(null)} />}

        <PlatformPasswordDialog
          key={forced ? "forced" : `pw-${passwordSeq}`}
          open={forced || passwordOpen}
          onOpenChange={setPasswordOpen}
          forced={forced}
          onChanged={onAdminChange}
          onSignOut={() => void signOut()}
        />
      </div>
    </ConsoleContext.Provider>
  );
}
