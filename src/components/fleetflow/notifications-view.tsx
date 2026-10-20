"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Image as ImageIcon,
  Mail,
  PackageCheck,
  Truck,
  UserX,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, useApiData } from "@/lib/api-client";
import { formatDateTime, timeAgo } from "@/lib/format";
import type { NotificationItem } from "@/lib/types";
import { goToDelivery, useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

// ── notification type presentation ───────────────────────────

interface NotificationMeta {
  icon: LucideIcon;
  tint: string;
}

const NOTIF_META: Record<string, NotificationMeta> = {
  NEW_ASSIGNMENT: {
    icon: PackageCheck,
    tint: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  UNASSIGNED: {
    icon: UserX,
    tint: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400",
  },
  PICKED_UP: {
    icon: PackageCheck,
    tint: "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300",
  },
  IN_TRANSIT: {
    icon: Truck,
    tint: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300",
  },
  DELIVERED: {
    icon: CheckCircle2,
    tint: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  FAILED: {
    icon: AlertTriangle,
    tint: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  },
  POD_UPLOADED: {
    icon: ImageIcon,
    tint: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  },
};

const DEFAULT_META: NotificationMeta = {
  icon: Bell,
  tint: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400",
};

// ── in-app list ──────────────────────────────────────────────

function InAppList({
  items,
  loading,
  error,
  onOpen,
}: {
  items: NotificationItem[];
  loading: boolean;
  error: string | null;
  onOpen: (n: NotificationItem) => void;
}) {
  if (loading && items.length === 0 && !error) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[76px] w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">Failed to load notifications: {error}</p>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="p-10 text-center">
        <Bell className="mx-auto size-10 text-muted-foreground/50" aria-hidden />
        <h3 className="mt-4 font-medium">You&rsquo;re all caught up</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          New assignment and delivery alerts will show up here.
        </p>
      </Card>
    );
  }

  return (
    <div className="max-h-[600px] divide-y overflow-y-auto rounded-xl border bg-card">
      {items.map((n) => {
        const meta = NOTIF_META[n.type] ?? DEFAULT_META;
        const Icon = meta.icon;
        const unread = !n.readAt;
        return (
          <button
            key={n.id}
            type="button"
            onClick={() => onOpen(n)}
            className={cn(
              "flex min-h-11 w-full items-start gap-3 p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
              n.deliveryId ? "cursor-pointer hover:bg-muted/50" : "cursor-default",
              unread && "bg-primary/5",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
                meta.tint,
              )}
              aria-hidden
            >
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm leading-snug", unread ? "font-semibold" : "font-medium")}>
                {n.title}
              </span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{n.body}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
            </span>
            <span className="mt-1 flex shrink-0 items-center gap-1.5">
              {unread && (
                <span className="size-2 rounded-full bg-emerald-500" role="img" aria-label="Unread" />
              )}
              {n.deliveryId && (
                <ChevronRight className="size-4 text-muted-foreground/60" aria-hidden />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── email outbox ─────────────────────────────────────────────

function EmailOutbox({ items, loading }: { items: NotificationItem[]; loading: boolean }) {
  if (loading && items.length === 0) {
    return (
      <Card className="p-6" aria-busy="true">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="p-10 text-center">
        <Mail className="mx-auto size-10 text-muted-foreground/50" aria-hidden />
        <h3 className="mt-4 font-medium">No emails yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          No emails yet — assign a delivery or complete one to trigger alerts.
        </p>
      </Card>
    );
  }

  return (
    <div className="max-h-[600px] overflow-y-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead>To</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Body</TableHead>
            <TableHead>Sent</TableHead>
            <TableHead>Type</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((n) => {
            const meta = NOTIF_META[n.type] ?? DEFAULT_META;
            return (
              <TableRow key={n.id}>
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  {n.recipientEmail ?? "—"}
                </TableCell>
                <TableCell className="max-w-[200px]">
                  <p className="truncate font-medium">{n.title}</p>
                </TableCell>
                <TableCell className="max-w-[260px]">
                  <p className="truncate text-sm text-muted-foreground">{n.body}</p>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <p className="text-sm">{formatDateTime(n.createdAt)}</p>
                  <p className="text-xs text-muted-foreground">{timeAgo(n.createdAt)}</p>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn("font-mono text-xs whitespace-nowrap", meta.tint)}
                  >
                    {n.type}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ── main view ────────────────────────────────────────────────

export function NotificationsView() {
  const session = useAppStore((s) => s.session);
  const isAdmin = session?.role === "ADMIN";

  const inApp = useApiData<{ items: NotificationItem[]; unread: number }>("/api/notifications");
  const email = useApiData<{ items: NotificationItem[] }>(
    isAdmin ? "/api/notifications?channel=EMAIL" : null,
  );
  const [markingAll, setMarkingAll] = useState(false);

  const unread = inApp.data?.unread ?? 0;

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await api.post("/api/notifications/read", { all: true });
      toast.success("All notifications marked as read");
      useAppStore.getState().bump();
      inApp.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to mark notifications");
    } finally {
      setMarkingAll(false);
    }
  };

  const openNotification = async (n: NotificationItem) => {
    if (!n.deliveryId) return;
    try {
      await api.post("/api/notifications/read", { ids: [n.id] });
      useAppStore.getState().bump();
    } catch {
      // Navigation should still work even if marking read fails.
    }
    const store = useAppStore.getState();
    if (store.session?.role === "ADMIN") {
      goToDelivery(n.deliveryId);
    } else {
      store.focusDelivery(n.deliveryId);
      store.setView("driver-jobs");
    }
  };

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Assignment and delivery alerts for your account.
        </p>
      </div>
      <Button
        variant="outline"
        onClick={() => void markAllRead()}
        disabled={markingAll || unread === 0}
        className="min-h-11 sm:min-h-10"
      >
        <CheckCheck aria-hidden /> Mark all as read
      </Button>
    </div>
  );

  const inAppList = (
    <InAppList
      items={inApp.data?.items ?? []}
      loading={inApp.loading}
      error={inApp.error}
      onOpen={(n) => void openNotification(n)}
    />
  );

  // Drivers only see their own in-app list — no tabs.
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        {header}
        {inAppList}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <Tabs defaultValue="in-app" className="gap-4">
        <TabsList>
          <TabsTrigger value="in-app" className="gap-1.5">
            <Bell aria-hidden /> In-app
            {unread > 0 && (
              <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none font-semibold text-primary-foreground">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="email" className="gap-1.5">
            <Mail aria-hidden /> Email outbox
          </TabsTrigger>
        </TabsList>
        <TabsContent value="in-app">{inAppList}</TabsContent>
        <TabsContent value="email" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Email delivery is simulated in this demo — outbound messages are captured here. Plug in
            a provider (Resend/SendGrid/SES) to send for real.
          </p>
          <EmailOutbox items={email.data?.items ?? []} loading={email.loading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default NotificationsView;
