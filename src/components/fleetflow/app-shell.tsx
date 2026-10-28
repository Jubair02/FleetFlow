"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Package,
  Split,
  Users,
  Truck,
  BarChart3,
  Bell,
  ScrollText,
  PackageCheck,
  History,
  LogOut,
  Menu,
  Sun,
  Moon,
  CheckCheck,
  Settings,
  KeyRound,
  Building2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, useApiData } from "@/lib/api-client";
import { useAppStore, type AppView } from "@/store/app-store";
import { initials, timeAgo } from "@/lib/format";
import type { NotificationItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChangePasswordDialog } from "@/components/fleetflow/change-password-dialog";
import {
  DockedSidebar,
  PremiumSidebar,
  SIDEBAR_SHEET_CLASS,
  SidebarFooterNote,
  type SidebarMode,
  type SidebarNavGroup,
} from "@/components/shared/sidebar/premium-sidebar";
import { useSidebarCollapsed } from "@/components/shared/sidebar/use-sidebar-collapsed";
import { DeveloperCredit } from "@/components/shared/developer-credit";

const ADMIN_NAV: { section: string; items: { view: AppView; label: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    section: "Operations",
    items: [
      { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { view: "deliveries", label: "Deliveries", icon: Package },
      { view: "dispatch", label: "Dispatch Board", icon: Split },
    ],
  },
  {
    section: "Fleet",
    items: [
      { view: "drivers", label: "Drivers", icon: Users },
      { view: "vehicles", label: "Vehicles", icon: Truck },
    ],
  },
  {
    section: "Insights",
    items: [
      { view: "reports", label: "Reports", icon: BarChart3 },
      { view: "notifications", label: "Notifications", icon: Bell },
      { view: "audit", label: "Audit Log", icon: ScrollText },
    ],
  },
  {
    section: "Company",
    items: [{ view: "settings", label: "Settings", icon: Settings }],
  },
];

const DRIVER_NAV: { section: string; items: { view: AppView; label: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    section: "Driving",
    items: [
      { view: "driver-jobs", label: "My Jobs", icon: PackageCheck },
      { view: "driver-history", label: "My History", icon: History },
    ],
  },
  {
    section: "Account",
    items: [{ view: "notifications", label: "Notifications", icon: Bell }],
  },
];

const VIEW_TITLES: Record<AppView, string> = {
  dashboard: "Operations Dashboard",
  deliveries: "Deliveries",
  dispatch: "Dispatch Board",
  drivers: "Drivers",
  vehicles: "Vehicles",
  reports: "Reports & Analytics",
  notifications: "Notifications",
  audit: "Audit Log",
  settings: "Settings",
  "driver-jobs": "My Jobs",
  "driver-history": "My History",
};

/** Ends the server session, then clears session + navigation state client-side. */
function useLogout(onDone?: () => void) {
  const [loggingOut, setLoggingOut] = useState(false);
  const logout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await api.post("/api/auth/logout");
    } catch {
      /* ignore — sign out locally regardless */
    }
    useAppStore.getState().signOut();
    onDone?.();
  }, [onDone]);
  return { logout, loggingOut };
}

type NotificationFeed = ReturnType<typeof useNotificationFeed>;

/** One notifications feed per shell — shared by the header bell and the sidebar badge. */
function useNotificationFeed() {
  const bump = useAppStore((s) => s.bump);
  const feed = useApiData<{ items: NotificationItem[]; unread: number }>("/api/notifications");
  const { data, reload } = feed;

  // poll for new notifications every 45s
  useEffect(() => {
    const t = setInterval(reload, 45000);
    return () => clearInterval(t);
  }, [reload]);

  // New notifications (e.g. a fresh assignment) → refresh every mounted view.
  const prevUnread = useRef<number | null>(null);
  useEffect(() => {
    if (!data) return;
    if (prevUnread.current !== null && data.unread > prevUnread.current) bump();
    prevUnread.current = data.unread;
  }, [data, bump]);

  return feed;
}

function NotificationBell({ feed, triggerClassName }: { feed: NotificationFeed; triggerClassName?: string }) {
  const setView = useAppStore((s) => s.setView);
  const bump = useAppStore((s) => s.bump);
  const session = useAppStore((s) => s.session);
  const [open, setOpen] = useState(false);
  const { data, loading, error } = feed;

  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];

  const markAllRead = async () => {
    try {
      await api.post("/api/notifications/read", { all: true });
      bump();
    } catch {
      toast.error("Could not mark notifications as read");
    }
  };

  const openItem = (n: NotificationItem) => {
    setOpen(false);
    if (!n.readAt) {
      api
        .post("/api/notifications/read", { ids: [n.id] })
        .then(() => bump())
        .catch(() => {
          /* non-critical — it stays unread */
        });
    }
    if (n.deliveryId) {
      useAppStore.getState().focusDelivery(n.deliveryId);
      setView(session?.role === "DRIVER" ? "driver-jobs" : "deliveries");
    } else {
      setView("notifications");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("relative", triggerClassName)} aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4.5 min-w-4.5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div className="text-sm font-semibold">Notifications</div>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllRead}>
              <CheckCheck className="mr-1 size-3.5" /> Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto overscroll-contain">
          {!data && loading ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : !data && error ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">Couldn&apos;t load notifications.</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</div>
          ) : (
            <div className="divide-y">
              {items.slice(0, 8).map((n) => (
                <button
                  key={n.id}
                  className={cn("flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/50", !n.readAt && "bg-primary/5")}
                  onClick={() => openItem(n)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("truncate text-sm", n.readAt ? "font-medium" : "font-semibold")}>{n.title}</span>
                    {!n.readAt && <span className="size-2 shrink-0 rounded-full bg-primary" role="img" aria-label="Unread" />}
                  </div>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
                  <span className="text-[11px] text-muted-foreground/70">{timeAgo(n.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => {
              setOpen(false);
              setView("notifications");
            }}
          >
            View all notifications
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ThemeToggle({ className }: { className?: string } = {}) {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      className={className}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {/* CSS-driven icon swap avoids hydration mismatch without setState-in-effect */}
      <Sun className="size-5 hidden dark:block" />
      <Moon className="size-5 dark:hidden" />
    </Button>
  );
}

/** Driver phones: theme switch lives in the account menu (header stays compact). */
function DriverThemeMenuItem() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <DropdownMenuItem
      className="cursor-pointer max-md:min-h-11 md:hidden"
      onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="mr-2 hidden size-4 dark:block" />
      <Moon className="mr-2 size-4 dark:hidden" />
      <span className="dark:hidden">Dark mode</span>
      <span className="hidden dark:inline">Light mode</span>
    </DropdownMenuItem>
  );
}

function CompanySidebar({
  mode,
  unread,
  collapsed,
  onToggleCollapsed,
  onRequestOverlay,
  onNavigate,
  onChangePassword,
  onSignOut,
  signingOut,
}: {
  mode: SidebarMode;
  unread: number;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onRequestOverlay?: () => void;
  onNavigate?: () => void;
  onChangePassword: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const session = useAppStore((s) => s.session);
  if (!session) return null;
  const isAdmin = session.role === "ADMIN";
  const nav = isAdmin ? ADMIN_NAV : DRIVER_NAV;
  const go = (v: AppView) => {
    setView(v);
    onNavigate?.();
  };

  const groups: SidebarNavGroup[] = nav.map((group) => ({
    label: group.section,
    items: group.items.map((item) => ({
      key: item.view,
      label: item.label,
      icon: item.icon,
      active: view === item.view,
      badge: item.view === "notifications" ? unread : undefined,
      badgeLabel: "unread",
      onSelect: () => go(item.view),
    })),
  }));

  return (
    <PremiumSidebar
      mode={mode}
      accent="emerald"
      brand={{ title: "FleetFlow", subtitle: "Fleet & Delivery" }}
      navLabel="Main navigation"
      groups={groups}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      onRequestOverlay={onRequestOverlay}
      footer={
        <SidebarFooterNote icon={Building2} label={`Organization: ${session.organizationName}`}>
          <div className="text-[11px] text-(--ff-sidebar-muted)">Organization</div>
          <div className="truncate text-sm font-medium text-white">{session.organizationName}</div>
        </SidebarFooterNote>
      }
      user={{
        name: session.name,
        detail: isAdmin ? "Dispatcher · Admin" : "Driver",
        initials: initials(session.name),
        menuLabel: (
          <>
            <div className="truncate text-sm font-semibold">{session.name}</div>
            <div className="truncate text-xs font-normal text-muted-foreground">{session.email}</div>
          </>
        ),
        menu: (
          <>
            {isAdmin && (
              <DropdownMenuItem className="cursor-pointer" onSelect={() => go("settings")}>
                <Settings className="mr-2 size-4" /> Company settings
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="cursor-pointer" onSelect={onChangePassword}>
              <KeyRound className="mr-2 size-4" /> Change password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer" disabled={signingOut} onSelect={onSignOut}>
              <LogOut className="mr-2 size-4" /> Sign out
            </DropdownMenuItem>
          </>
        ),
      }}
    />
  );
}

function DriverBottomNav() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const items: { view: AppView; label: string; icon: typeof PackageCheck }[] = [
    { view: "driver-jobs", label: "Jobs", icon: PackageCheck },
    { view: "driver-history", label: "History", icon: History },
    { view: "notifications", label: "Alerts", icon: Bell },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-16px_rgb(0_0_0/0.18)] backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden dark:border-white/10 dark:shadow-none"
      aria-label="Driver navigation"
    >
      <div className="mx-auto grid max-w-md grid-cols-3 gap-2 px-3 pt-1.5 pb-1.5">
        {items.map((item) => {
          const active = view === item.view;
          const Icon = item.icon;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => setView(item.view)}
              className={cn(
                "group flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-medium outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
              aria-current={active ? "page" : undefined}
            >
              <span
                className={cn(
                  "flex h-8 w-14 items-center justify-center rounded-full transition-[background-color,transform] duration-200 motion-safe:group-active:scale-95",
                  active ? "bg-primary/12 dark:bg-primary/15" : "bg-transparent"
                )}
                aria-hidden="true"
              >
                <Icon className="size-5" strokeWidth={active ? 2.25 : 2} />
              </span>
              <span className={cn(active && "font-semibold")}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const view = useAppStore((s) => s.view);
  const session = useAppStore((s) => s.session);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const setView = useAppStore((s) => s.setView);
  const { logout, loggingOut } = useLogout();
  const isDriver = session?.role === "DRIVER";
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSeq, setPasswordSeq] = useState(0);
  // A temporary password (set by an admin) must be replaced before using the app.
  const forcePasswordChange = !!session?.mustChangePassword;
  const openPasswordDialog = () => {
    setPasswordSeq((n) => n + 1);
    setPasswordOpen(true);
  };
  const notifications = useNotificationFeed();
  const unread = notifications.data?.unread ?? 0;
  const [collapsed, setCollapsed] = useSidebarCollapsed("fleetflow:sidebar-collapsed:app");

  return (
    <div className="flex min-h-dvh w-full bg-background">
      {/* Docked sidebar: icon rail on md, full (collapsible) on ≥lg */}
      <DockedSidebar collapsed={collapsed}>
        <CompanySidebar
          mode="docked"
          unread={unread}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed(!collapsed)}
          onRequestOverlay={() => setMobileNavOpen(true)}
          onChangePassword={openPasswordDialog}
          onSignOut={() => void logout()}
          signingOut={loggingOut}
        />
      </DockedSidebar>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:px-6">
          {/* Mobile nav */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              {/* Drivers navigate with the bottom bar on phones — no hamburger for them. */}
              <Button variant="ghost" size="icon" className={isDriver ? "hidden" : "md:hidden"} aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className={SIDEBAR_SHEET_CLASS}>
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">Switch between FleetFlow sections</SheetDescription>
              <CompanySidebar
                mode="sheet"
                unread={unread}
                onNavigate={() => setMobileNavOpen(false)}
                onChangePassword={() => {
                  setMobileNavOpen(false);
                  openPasswordDialog();
                }}
                onSignOut={() => {
                  setMobileNavOpen(false);
                  void logout();
                }}
                signingOut={loggingOut}
              />
            </SheetContent>
          </Sheet>

          {isDriver ? (
            <div className="min-w-0 leading-tight">
              <h1 className="truncate text-base font-semibold tracking-tight md:text-lg">{VIEW_TITLES[view]}</h1>
              <p className="truncate text-xs text-muted-foreground md:hidden">{session?.organizationName}</p>
            </div>
          ) : (
            <h1 className="truncate text-base font-semibold tracking-tight md:text-lg">{VIEW_TITLES[view]}</h1>
          )}
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell feed={notifications} triggerClassName={isDriver ? "max-md:size-11" : undefined} />
            {/* Drivers on phones get the theme switch inside the account menu instead. */}
            <ThemeToggle className={isDriver ? "max-md:hidden" : undefined} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "ml-1 rounded-full outline-none ring-primary/40 focus-visible:ring-2",
                    isDriver && "max-md:ml-0 max-md:flex max-md:size-11 max-md:items-center max-md:justify-center"
                  )}
                  aria-label="Account menu"
                >
                  <Avatar className="size-8 border">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{session ? initials(session.name) : "?"}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="text-sm font-semibold">{session?.name}</div>
                  <div className="text-xs font-normal text-muted-foreground">{session?.email}</div>
                  <div className="mt-1">
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                      {session?.role === "ADMIN" ? "Admin / Dispatcher" : "Driver"}
                    </Badge>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {session?.role === "ADMIN" && (
                  <DropdownMenuItem className="cursor-pointer" onSelect={() => setView("settings")}>
                    <Settings className="mr-2 size-4" /> Company settings
                  </DropdownMenuItem>
                )}
                {isDriver && <DriverThemeMenuItem />}
                <DropdownMenuItem className={cn("cursor-pointer", isDriver && "max-md:min-h-11")} onSelect={openPasswordDialog}>
                  <KeyRound className="mr-2 size-4" /> Change password
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className={cn("cursor-pointer", isDriver && "max-md:min-h-11")} disabled={loggingOut} onSelect={() => void logout()}>
                  <LogOut className="mr-2 size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className={cn("flex-1 px-4 py-5 md:px-6 md:py-6", isDriver && "pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-6")}>{children}</main>

        <footer className={cn("mt-auto border-t bg-background", isDriver && "hidden md:block")}>
          <div className="flex flex-col items-center justify-between gap-1 px-6 py-3 text-xs text-muted-foreground md:flex-row md:gap-6">
            <span className="shrink-0">© {new Date().getFullYear()} FleetFlow — Fleet &amp; Delivery Management</span>
            <div className="flex min-w-0 max-w-full flex-col items-center gap-1.5 md:flex-row md:gap-3">
              {session?.organizationName && (
                <>
                  <span className="max-w-full truncate" title={session.organizationName}>{session.organizationName}</span>
                  <span aria-hidden="true" className="hidden h-3 w-px shrink-0 bg-border md:block" />
                </>
              )}
              <DeveloperCredit />
            </div>
          </div>
        </footer>
      </div>

      {/* Driver mobile bottom navigation */}
      {isDriver && <DriverBottomNav />}

      <ChangePasswordDialog
        key={forcePasswordChange ? "forced" : `pw-${passwordSeq}`}
        open={forcePasswordChange || passwordOpen}
        onOpenChange={setPasswordOpen}
        forced={forcePasswordChange}
        onSignOut={() => void logout()}
      />
    </div>
  );
}

export { VIEW_TITLES };
