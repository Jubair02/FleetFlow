"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  ExternalLink,
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
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  "driver-jobs": "My Jobs",
  "driver-history": "My History",
};

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Truck className="size-5" />
      </div>
      <div className="leading-tight">
        <div className="font-semibold tracking-tight text-sidebar-foreground">FleetFlow</div>
        <div className="text-[11px] text-muted-foreground">Fleet &amp; Delivery</div>
      </div>
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const session = useAppStore((s) => s.session);
  const nav = session?.role === "ADMIN" ? ADMIN_NAV : DRIVER_NAV;

  return (
    <nav className="flex flex-col gap-5" aria-label="Main navigation">
      {nav.map((group) => (
        <div key={group.section}>
          <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{group.section}</div>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = view === item.view;
              const Icon = item.icon;
              return (
                <button
                  key={item.view}
                  onClick={() => {
                    setView(item.view);
                    onNavigate?.();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function UserCard({ onNavigate }: { onNavigate?: () => void }) {
  const session = useAppStore((s) => s.session);
  const setSession = useAppStore((s) => s.setSession);
  const [loggingOut, setLoggingOut] = useState(false);
  if (!session) return null;

  const logout = async () => {
    setLoggingOut(true);
    try {
      await api.post("/api/auth/logout");
    } catch {
      /* ignore */
    }
    setSession(null);
    onNavigate?.();
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border bg-card p-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar className="size-8 border">
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{initials(session.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-medium">{session.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {session.role === "ADMIN" ? "Dispatcher · Admin" : "Driver"} · {session.organizationName}
          </div>
        </div>
      </div>
      <Button variant="ghost" size="icon" onClick={logout} disabled={loggingOut} title="Sign out" aria-label="Sign out">
        <LogOut className="size-4" />
      </Button>
    </div>
  );
}

function NotificationBell() {
  const setView = useAppStore((s) => s.setView);
  const session = useAppStore((s) => s.session);
  const { data, reload } = useApiData<{ items: NotificationItem[]; unread: number }>("/api/notifications");

  // poll for new notifications every 45s
  useEffect(() => {
    const t = setInterval(reload, 45000);
    return () => clearInterval(t);
  }, [reload]);

  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];

  const markAllRead = async () => {
    try {
      await api.post("/api/notifications/read", { all: true });
      reload();
    } catch {
      toast.error("Could not mark notifications as read");
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
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
        <ScrollArea className="max-h-80">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</div>
          ) : (
            <div className="divide-y">
              {items.slice(0, 8).map((n) => (
                <button
                  key={n.id}
                  className={cn("flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/50", !n.readAt && "bg-primary/5")}
                  onClick={() => {
                    if (n.deliveryId) {
                      useAppStore.getState().focusDelivery(n.deliveryId);
                      setView(session?.role === "DRIVER" ? "driver-jobs" : "deliveries");
                    } else {
                      setView("notifications");
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("truncate text-sm", n.readAt ? "font-medium" : "font-semibold")}>{n.title}</span>
                    {!n.readAt && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                  </div>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
                  <span className="text-[11px] text-muted-foreground/70">{timeAgo(n.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
        <div className="border-t p-2">
          <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setView("notifications")}>
            View all notifications
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {/* CSS-driven icon swap avoids hydration mismatch without setState-in-effect */}
      <Sun className="size-5 hidden dark:block" />
      <Moon className="size-5 dark:hidden" />
    </Button>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const session = useAppStore((s) => s.session);
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Logo />
      <div className="flex-1 overflow-y-auto">
        <NavLinks onNavigate={onNavigate} />
      </div>
      <div className="flex flex-col gap-3">
        {session?.role === "ADMIN" && (
          <div className="rounded-lg border border-dashed px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">Demo org:</span> {session.organizationName}. Multi-tenant isolation is enforced on every API.
          </div>
        )}
        <UserCard onNavigate={onNavigate} />
      </div>
    </div>
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
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-label="Driver navigation">
      <div className="grid grid-cols-3">
        {items.map((item) => {
          const active = view === item.view;
          const Icon = item.icon;
          return (
            <button
              key={item.view}
              onClick={() => setView(item.view)}
              className={cn("flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="size-5" />
              {item.label}
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
  const isDriver = session?.role === "DRIVER";

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <SidebarContent />
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:px-6">
          {/* Mobile nav */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
            </SheetContent>
          </Sheet>

          <h1 className="truncate text-base font-semibold tracking-tight md:text-lg">{VIEW_TITLES[view]}</h1>
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-1 rounded-full outline-none ring-primary/40 focus-visible:ring-2" aria-label="Account menu">
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
                <DropdownMenuItem asChild>
                  <Link href="/?tour=1" className="cursor-pointer" onClick={(e) => { e.preventDefault(); toast.info("Tip: use the Dispatch Board to assign pending deliveries to drivers."); }}>
                    <ExternalLink className="mr-2 size-4" /> About this demo
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className={cn("flex-1 px-4 py-5 md:px-6 md:py-6", isDriver && "pb-24 md:pb-6")}>{children}</main>

        <footer className={cn("mt-auto border-t bg-background", isDriver && "hidden md:block")}>
          <div className="flex flex-col items-center justify-between gap-1 px-6 py-3 text-xs text-muted-foreground sm:flex-row">
            <span>© {new Date().getFullYear()} FleetFlow — Fleet &amp; Delivery Management</span>
            <span>{session?.organizationName ?? ""}</span>
          </div>
        </footer>
      </div>

      {/* Driver mobile bottom navigation */}
      {isDriver && <DriverBottomNav />}
    </div>
  );
}

export { VIEW_TITLES };
