"use client";

import { createContext, useContext, type ReactNode } from "react";
import { ChevronLeft, ChevronsUpDown, Moon, Sun, Truck, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/* ------------------------------------------------------------------ types */

export type SidebarAccent = "emerald" | "violet";

export interface SidebarNavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Unread/pending count — rendered as a red pill (capped at 99+). */
  badge?: number;
  /** Screen-reader noun for the badge, e.g. "unread". */
  badgeLabel?: string;
  active?: boolean;
  onSelect: () => void;
}

export interface SidebarNavGroup {
  label: string;
  items: SidebarNavItem[];
}

export interface SidebarUser {
  name: string;
  /** Second line under the name (email or role). */
  detail: string;
  initials: string;
  /** Header shown at the top of the account menu. */
  menuLabel?: ReactNode;
  /** DropdownMenuItems for the account menu (theme item is added automatically). */
  menu: ReactNode;
}

/**
 * - "docked": the fixed desktop/tablet panel — icon rail on md, full on ≥lg
 *   unless the user collapsed it (then rail on ≥lg too).
 * - "sheet": inside the mobile/tablet overlay Sheet — always full.
 */
export type SidebarMode = "docked" | "sheet";

export interface PremiumSidebarProps {
  mode: SidebarMode;
  accent: SidebarAccent;
  brand: { title: string; subtitle: string; marker?: ReactNode };
  navLabel: string;
  groups: SidebarNavGroup[];
  /** Org chip / audited note etc. Use <SidebarFooterNote> so it adapts to the rail. */
  footer?: ReactNode;
  user: SidebarUser;
  collapsed?: boolean;
  /** ≥lg: toggle the remembered collapsed state. */
  onToggleCollapsed?: () => void;
  /** md (768–1023px): the rail's expand button opens the full panel as an overlay. */
  onRequestOverlay?: () => void;
}

/* ---------------------------------------------------- visibility helpers */

interface SidebarCtx {
  mode: SidebarMode;
  /** Classes that show an element only when the panel is full width. */
  fullOnly: string;
  /** Classes that show an element only when the panel is the icon rail. */
  railOnly: string;
}

const Ctx = createContext<SidebarCtx>({ mode: "sheet", fullOnly: "", railOnly: "hidden" });

/** Rail vs full is decided by CSS (breakpoints), so the server render already matches. */
function visibility(mode: SidebarMode, collapsed: boolean): SidebarCtx {
  if (mode === "sheet") return { mode, fullOnly: "", railOnly: "hidden" };
  if (collapsed) return { mode, fullOnly: "hidden", railOnly: "" };
  return { mode, fullOnly: "max-lg:hidden", railOnly: "lg:hidden" };
}

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-(--ff-sidebar-accent-strong) focus-visible:ring-offset-2 focus-visible:ring-offset-(--ff-sidebar-bg)";

/** Dark tooltip that matches the navy panel (the default tooltip is brand-coloured). */
const TOOLTIP_CLASS =
  "border border-white/10 bg-slate-900 px-2.5 py-1.5 text-[13px] font-medium text-white shadow-lg [&_svg]:bg-slate-900 [&_svg]:fill-slate-900";

export function formatBadge(n: number) {
  return n > 99 ? "99+" : String(n);
}

/** Tooltip shown only while the panel is a rail (hidden by CSS when it is full). */
function RailTooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  const { mode, railOnly } = useContext(Ctx);
  if (mode === "sheet") return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className={cn(TOOLTIP_CLASS, railOnly)}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/* ------------------------------------------------------------- pieces */

function BrandHeader({ brand }: { brand: PremiumSidebarProps["brand"] }) {
  const { mode, fullOnly } = useContext(Ctx);
  return (
    <div className={cn("flex min-h-11 items-center gap-3", mode === "sheet" && "pr-8")}>
      <div
        className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-(--ff-sidebar-accent-strong) to-(--ff-sidebar-accent) text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_8px_20px_-10px_var(--ff-sidebar-accent-shadow)] ring-1 ring-white/10"
        aria-hidden
      >
        <Truck className="size-5" strokeWidth={2} />
      </div>
      <div className={cn("min-w-0 leading-tight", fullOnly)}>
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold tracking-tight text-(--ff-sidebar-fg-strong)">{brand.title}</span>
          {brand.marker}
        </div>
        <div className="truncate text-xs text-(--ff-sidebar-muted)">{brand.subtitle}</div>
      </div>
    </div>
  );
}

function NavItem({ item }: { item: SidebarNavItem }) {
  const { fullOnly, railOnly } = useContext(Ctx);
  const Icon = item.icon;
  const count = item.badge && item.badge > 0 ? item.badge : 0;
  const a11yLabel = count ? `${item.label}, ${count} ${item.badgeLabel ?? "new"}` : item.label;

  return (
    <RailTooltip
      label={
        <span className="flex items-center gap-2">
          {item.label}
          {count > 0 && <span className="rounded-full bg-rose-600 px-1.5 text-[11px] font-semibold leading-4 text-white">{formatBadge(count)}</span>}
        </span>
      }
    >
      <button
        type="button"
        onClick={item.onSelect}
        aria-label={a11yLabel}
        aria-current={item.active ? "page" : undefined}
        className={cn(
          "group/item relative flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium",
          "motion-safe:transition-[background-color,color,box-shadow] motion-safe:duration-200",
          FOCUS_RING,
          item.active
            ? "bg-(--ff-sidebar-accent) text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_10px_24px_-12px_var(--ff-sidebar-accent-shadow)]"
            : "text-(--ff-sidebar-fg) hover:bg-(--ff-sidebar-hover) hover:text-white motion-safe:active:scale-[0.98]"
        )}
      >
        <span className="relative flex shrink-0 items-center justify-center" aria-hidden>
          <Icon className={cn("size-5", item.active ? "text-white" : "text-(--ff-sidebar-muted) group-hover/item:text-white")} strokeWidth={1.9} />
          {count > 0 && (
            <span
              className={cn(
                "absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-(--ff-sidebar-bg)",
                railOnly
              )}
            >
              {formatBadge(count)}
            </span>
          )}
        </span>
        <span className={cn("min-w-0 flex-1 truncate", fullOnly)}>{item.label}</span>
        {count > 0 && (
          <span
            className={cn(
              "ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-semibold tabular-nums text-white",
              item.active && "ring-1 ring-white/30",
              fullOnly
            )}
            aria-hidden
          >
            {formatBadge(count)}
          </span>
        )}
      </button>
    </RailTooltip>
  );
}

/** Footer note that collapses to an icon (with tooltip) in the rail. */
export function SidebarFooterNote({
  icon: Icon,
  label,
  tone = "neutral",
  children,
}: {
  icon: LucideIcon;
  /** Short accessible text — used for the rail icon's tooltip/aria-label. */
  label: string;
  tone?: "neutral" | "accent";
  children: ReactNode;
}) {
  const { fullOnly, railOnly, mode } = useContext(Ctx);
  return (
    <>
      <div
        className={cn(
          "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs leading-snug",
          tone === "accent"
            ? "border-(--ff-sidebar-accent-strong)/25 bg-(--ff-sidebar-accent-soft) text-(--ff-sidebar-accent-fg)"
            : "border-(--ff-sidebar-border) bg-(--ff-sidebar-raised) text-(--ff-sidebar-fg)",
          fullOnly
        )}
      >
        <Icon className={cn("mt-px size-4 shrink-0", tone === "accent" ? "text-(--ff-sidebar-accent-fg)" : "text-(--ff-sidebar-muted)")} aria-hidden />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {mode === "docked" && (
        <RailTooltip label={label}>
          <span
            role="img"
            aria-label={label}
            className={cn(
              "mx-auto flex size-11 items-center justify-center rounded-xl",
              tone === "accent" ? "bg-(--ff-sidebar-accent-soft) text-(--ff-sidebar-accent-fg)" : "text-(--ff-sidebar-muted)",
              railOnly
            )}
          >
            <Icon className="size-5" aria-hidden />
          </span>
        </RailTooltip>
      )}
    </>
  );
}

/** Light/dark switch for the account menu. CSS-driven label swap avoids hydration mismatch. */
export function SidebarThemeMenuItem({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <DropdownMenuItem className={cn("cursor-pointer", className)} onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      <Sun className="mr-2 hidden size-4 dark:block" aria-hidden />
      <Moon className="mr-2 size-4 dark:hidden" aria-hidden />
      <span className="dark:hidden">Dark mode</span>
      <span className="hidden dark:inline">Light mode</span>
    </DropdownMenuItem>
  );
}

function UserCard({ user }: { user: SidebarUser }) {
  const { fullOnly, mode } = useContext(Ctx);
  return (
    <DropdownMenu>
      <RailTooltip label={user.name}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Account menu for ${user.name}`}
            className={cn(
              "group/user flex w-full items-center gap-3 rounded-xl border border-(--ff-sidebar-border) bg-(--ff-sidebar-raised) p-[3px] text-left",
              "hover:bg-(--ff-sidebar-hover) data-[state=open]:bg-(--ff-sidebar-hover) motion-safe:transition-colors motion-safe:duration-200",
              FOCUS_RING
            )}
          >
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-(--ff-sidebar-accent-soft) text-xs font-semibold text-(--ff-sidebar-accent-fg) ring-1 ring-white/10"
              aria-hidden
            >
              {user.initials}
            </span>
            <span className={cn("min-w-0 flex-1 leading-tight", fullOnly)}>
              <span className="block truncate text-sm font-medium text-(--ff-sidebar-fg-strong)">{user.name}</span>
              <span className="block truncate text-xs text-(--ff-sidebar-muted)">{user.detail}</span>
            </span>
            <ChevronsUpDown className={cn("mr-2 size-4 shrink-0 text-(--ff-sidebar-muted) group-hover/user:text-white", fullOnly)} aria-hidden />
          </button>
        </DropdownMenuTrigger>
      </RailTooltip>
      <DropdownMenuContent side={mode === "sheet" ? "top" : "right"} align="end" sideOffset={10} className="w-60">
        {user.menuLabel && (
          <>
            <DropdownMenuLabel>{user.menuLabel}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <SidebarThemeMenuItem />
        {user.menu}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CollapseToggle({ collapsed, onToggleCollapsed, onRequestOverlay }: Pick<PremiumSidebarProps, "collapsed" | "onToggleCollapsed" | "onRequestOverlay">) {
  const { fullOnly, railOnly } = useContext(Ctx);
  const onClick = () => {
    const isLg = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
    if (isLg) onToggleCollapsed?.();
    else onRequestOverlay?.();
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute top-[30px] -right-3 z-10 flex size-6 items-center justify-center rounded-full border border-white/15 bg-(--ff-sidebar-bg-2) text-(--ff-sidebar-fg) shadow-md",
        "hover:bg-(--ff-sidebar-accent) hover:text-white motion-safe:transition-colors motion-safe:duration-200",
        FOCUS_RING,
        // a 24px visual control with a 40px hit area
        "after:absolute after:-inset-2 after:content-['']"
      )}
    >
      <ChevronLeft className={cn("size-3.5 motion-safe:transition-transform motion-safe:duration-200", collapsed ? "rotate-180" : "max-lg:rotate-180")} aria-hidden />
      <span className={fullOnly}>
        <span className="sr-only">Collapse sidebar</span>
      </span>
      <span className={railOnly}>
        <span className="sr-only">Expand sidebar</span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------ the panel */

export function PremiumSidebar({
  mode,
  accent,
  brand,
  navLabel,
  groups,
  footer,
  user,
  collapsed = false,
  onToggleCollapsed,
  onRequestOverlay,
}: PremiumSidebarProps) {
  const ctx = visibility(mode, collapsed);
  return (
    <Ctx.Provider value={ctx}>
      <div
        data-ff-accent={accent}
        className={cn(
          "relative flex h-full w-full flex-col bg-(image:--ff-sidebar-surface) text-(--ff-sidebar-fg)",
          mode === "docked" ? "border-r border-(--ff-sidebar-border)" : "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
        )}
      >
        <div className="px-4 pt-5 pb-4">
          <BrandHeader brand={brand} />
        </div>

        {mode === "docked" && <CollapseToggle collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} onRequestOverlay={onRequestOverlay} />}

        <div className="mx-4 h-px bg-(--ff-sidebar-border)" aria-hidden />

        <nav aria-label={navLabel} className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-width:thin]">
          {groups.map((group, i) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <div className={cn("mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-(--ff-sidebar-muted)", ctx.fullOnly)} aria-hidden>
                {group.label}
              </div>
              {i > 0 && <div className={cn("mx-auto mb-3 h-px w-6 bg-white/10", ctx.railOnly)} aria-hidden />}
              <div className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <NavItem key={item.key} item={item} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-3 border-t border-(--ff-sidebar-border) px-4 pt-4 pb-4">
          {footer}
          <UserCard user={user} />
        </div>
      </div>
    </Ctx.Provider>
  );
}

/**
 * The fixed panel for ≥md. Width follows the rail/full state with a 200ms
 * transition; it sits in the shell's flex row so the main column reflows with it.
 */
export function DockedSidebar({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return (
    <aside
      className={cn(
        "sticky top-0 z-40 hidden h-dvh shrink-0 md:flex",
        "motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out",
        collapsed ? "md:w-[76px]" : "md:w-[76px] lg:w-[264px]"
      )}
    >
      {children}
    </aside>
  );
}

/** Classes for the shells' <SheetContent> so the overlay shows the navy panel edge to edge. */
export const SIDEBAR_SHEET_CLASS =
  "w-[288px] max-w-[85vw] gap-0 border-r-0 bg-[#0b1324] p-0 text-slate-300 sm:max-w-[288px] [&>button:last-child]:text-slate-300 [&>button:last-child]:ring-offset-[#0b1324] [&>button:last-child]:top-[34px]";
