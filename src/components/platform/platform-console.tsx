"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  ShieldCheck,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import type { PlatformAdminInfo } from "@/lib/platform-types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DockedSidebar,
  PremiumSidebar,
  SIDEBAR_SHEET_CLASS,
  SidebarFooterNote,
  type SidebarMode,
  type SidebarNavGroup,
} from "@/components/shared/sidebar/premium-sidebar";
import { useSidebarCollapsed } from "@/components/shared/sidebar/use-sidebar-collapsed";
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
import { PlatformPasswordDialog } from "./password-dialog";
import { PlatformBadge } from "./shared";
import { OverviewView } from "./overview-view";
import { OrganizationsView } from "./organizations-view";
import { OrgDialog, type OrgDialogState } from "./organizations/dialog/org-dialog";
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

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      <Sun className="hidden size-5 dark:block" aria-hidden />
      <Moon className="size-5 dark:hidden" aria-hidden />
    </Button>
  );
}

function PlatformMarker() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-violet-400/30 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-200">
      <ShieldCheck className="size-3" aria-hidden /> Platform
    </span>
  );
}

function ConsoleSidebar({
  mode,
  admin,
  view,
  onSelect,
  collapsed,
  onToggleCollapsed,
  onRequestOverlay,
  onChangePassword,
  passwordDisabled,
  onSignOut,
  signingOut,
}: {
  mode: SidebarMode;
  admin: PlatformAdminInfo;
  view: PlatformView;
  onSelect: (v: PlatformView) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onRequestOverlay?: () => void;
  onChangePassword: () => void;
  passwordDisabled: boolean;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const groups: SidebarNavGroup[] = NAV.map((group) => ({
    label: group.section,
    items: group.items.map((item) => ({
      key: item.view,
      label: item.label,
      icon: item.icon,
      active: view === item.view,
      onSelect: () => onSelect(item.view),
    })),
  }));

  return (
    <PremiumSidebar
      mode={mode}
      accent="violet"
      brand={{ title: "FleetFlow", subtitle: "Super Admin Panel", marker: <PlatformMarker /> }}
      navLabel="Platform navigation"
      groups={groups}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      onRequestOverlay={onRequestOverlay}
      footer={
        <SidebarFooterNote icon={ShieldCheck} tone="accent" label="Platform console — actions here are audited">
          You are in the FleetFlow platform console — actions here affect customer organizations and are audited.
        </SidebarFooterNote>
      }
      user={{
        name: admin.name,
        detail: admin.email,
        initials: initials(admin.name),
        menuLabel: (
          <>
            <div className="truncate text-sm font-semibold">{admin.name}</div>
            <div className="truncate text-xs font-normal text-muted-foreground">Platform admin</div>
          </>
        ),
        menu: (
          <>
            <DropdownMenuItem className="cursor-pointer" onSelect={() => onSelect("settings")}>
              <Settings className="mr-2 size-4" aria-hidden /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" onSelect={onChangePassword} disabled={passwordDisabled}>
              <KeyRound className="mr-2 size-4" aria-hidden /> Change password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer" disabled={signingOut} onSelect={onSignOut}>
              <LogOut className="mr-2 size-4" aria-hidden /> Sign out
            </DropdownMenuItem>
          </>
        ),
      }}
    />
  );
}

/**
 * Signed-in console. Sign-in itself happens on the shared form at "/"; when
 * the platform session ends (401) or the admin signs out, the browser goes
 * back there — never into the company app's state.
 */
export function PlatformConsole({ initialAdmin }: { initialAdmin: PlatformAdminInfo }) {
  const [admin, setAdmin] = useState<PlatformAdminInfo>(initialAdmin);
  const router = useRouter();

  useEffect(() => onPlatformUnauthorized(() => router.replace("/?next=platform")), [router]);

  return (
    <ConsoleShell
      key={admin.id}
      admin={admin}
      onAdminChange={(a) => (a ? setAdmin(a) : router.replace("/"))}
      onSignedOut={() => router.replace("/")}
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
  const [orgDialog, setOrgDialog] = useState<OrgDialogState | null>(null);
  const [usersOrgFilter, setUsersOrgFilter] = useState<OrgRef | null>(null);
  const [auditOrgFilter, setAuditOrgFilter] = useState<OrgRef | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSeq, setPasswordSeq] = useState(0);
  const forced = admin.mustChangePassword;
  const [collapsed, setCollapsed] = useSidebarCollapsed("fleetflow:sidebar-collapsed:platform");

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
      openOrg: (id, tab = "overview") => setOrgDialog((prev) => ({ id, tab, seq: (prev?.seq ?? 0) + 1 })),
      showOrgUsers: (org) => {
        setUsersOrgFilter(org);
        setOrgDialog(null);
        setViewState("users");
      },
      showOrgAudit: (org) => {
        setAuditOrgFilter(org);
        setOrgDialog(null);
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
      <div className="flex min-h-dvh w-full bg-background">
        <DockedSidebar collapsed={collapsed}>
          <ConsoleSidebar
            mode="docked"
            admin={admin}
            view={view}
            onSelect={setView}
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed(!collapsed)}
            onRequestOverlay={() => setMobileNavOpen(true)}
            onChangePassword={ctx.openPasswordDialog}
            passwordDisabled={forced}
            onSignOut={() => void signOut()}
            signingOut={signingOut}
          />
        </DockedSidebar>

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
              <SheetContent side="left" className={SIDEBAR_SHEET_CLASS}>
                <SheetTitle className="sr-only">Platform navigation</SheetTitle>
                <SheetDescription className="sr-only">Switch between platform console sections</SheetDescription>
                <ConsoleSidebar
                  mode="sheet"
                  admin={admin}
                  view={view}
                  onSelect={setView}
                  onChangePassword={() => {
                    setMobileNavOpen(false);
                    ctx.openPasswordDialog();
                  }}
                  passwordDisabled={forced}
                  onSignOut={() => {
                    setMobileNavOpen(false);
                    void signOut();
                  }}
                  signingOut={signingOut}
                />
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

        {!forced && <OrgDialog state={orgDialog} onClose={() => setOrgDialog(null)} />}

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
