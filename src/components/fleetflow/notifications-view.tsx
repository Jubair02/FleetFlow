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
  Info,
  Mail,
  PackageCheck,
  RefreshCw,
  RotateCw,
  Send,
  Truck,
  UserX,
  type LucideIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

function LoadError({ what, error, onRetry }: { what: string; error: string; onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <p className="text-sm text-destructive">
        Failed to load {what}: {error}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw aria-hidden /> Try again
      </Button>
    </Card>
  );
}

function InAppList({
  items,
  loading,
  error,
  onOpen,
  onRetry,
}: {
  items: NotificationItem[];
  loading: boolean;
  error: string | null;
  onOpen: (n: NotificationItem) => void;
  onRetry: () => void;
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
    return <LoadError what="notifications" error={error} onRetry={onRetry} />;
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
              n.deliveryId || unread ? "cursor-pointer hover:bg-muted/50" : "cursor-default",
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

type EmailRowStatus = "PENDING" | "SENDING" | "SENT" | "FAILED" | "SIMULATED";

interface EmailOutboxItem extends NotificationItem {
  status: EmailRowStatus;
  attempts: number;
  sentAt: string | null;
  lastError: string | null;
}

interface EmailStatusInfo {
  provider: "resend" | "console";
  configured: boolean;
  from: string | null;
  warning: string | null;
}

interface EmailOutboxResponse {
  items: EmailOutboxItem[];
  emailStatus: EmailStatusInfo;
  maxAttempts: number;
  failedRetryable: number;
}

interface RetryResponse {
  attempted: number;
  sent: number;
  simulated: number;
  failed: number;
  skipped: number;
}

const EMAIL_STATUS_META: Record<EmailRowStatus, { label: string; className: string }> = {
  PENDING: {
    label: "Pending",
    className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
  },
  SENDING: {
    label: "Sending",
    className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300",
  },
  SENT: {
    label: "Sent",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  FAILED: {
    label: "Failed",
    className: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  },
  SIMULATED: {
    label: "Simulated",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  },
};

function EmailModeBanner({ status }: { status: EmailStatusInfo | null }) {
  if (!status) return null;
  if (status.provider === "resend") {
    return (
      <Alert role="status">
        <Send aria-hidden />
        <AlertTitle>Sending real email via Resend</AlertTitle>
        <AlertDescription>
          {status.from
            ? `Emails are sent from an address at ${status.from}.`
            : "Emails are sent from the configured sender."}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert role="status">
      <Info aria-hidden />
      <AlertTitle>Emails are simulated</AlertTitle>
      <AlertDescription>
        {status.warning && <p className="text-amber-700 dark:text-amber-400">{status.warning}</p>}
        <p>
          Nothing leaves the server — messages are only recorded here. To send for real, set
          EMAIL_PROVIDER=resend with RESEND_API_KEY and EMAIL_FROM (on a domain verified in
          Resend), then restart the app.
        </p>
      </AlertDescription>
    </Alert>
  );
}

function EmailOutbox({
  items,
  maxAttempts,
  loading,
  error,
  retrying,
  onRetry,
  onRetryEmail,
}: {
  items: EmailOutboxItem[];
  maxAttempts: number;
  loading: boolean;
  error: string | null;
  retrying: string | null;
  onRetry: () => void;
  onRetryEmail: (id: string) => void;
}) {
  if (error && items.length === 0) {
    return <LoadError what="the email outbox" error={error} onRetry={onRetry} />;
  }

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
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((n) => {
            const meta = NOTIF_META[n.type] ?? DEFAULT_META;
            const st = EMAIL_STATUS_META[n.status] ?? EMAIL_STATUS_META.PENDING;
            const canRetry = n.status === "FAILED" && n.attempts < maxAttempts;
            return (
              <TableRow key={n.id}>
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  {n.recipientEmail ?? "—"}
                </TableCell>
                <TableCell className="max-w-[260px]">
                  <p className="truncate font-medium">{n.title}</p>
                  <p className="truncate text-sm text-muted-foreground">{n.body}</p>
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <Badge variant="outline" className={cn("text-xs whitespace-nowrap", st.className)}>
                    {st.label}
                  </Badge>
                  {n.status === "FAILED" && (
                    <>
                      {n.lastError && (
                        <p className="mt-1 line-clamp-2 text-xs text-destructive" title={n.lastError}>
                          {n.lastError}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {n.attempts}/{maxAttempts} attempts{!canRetry && " — no retries left"}
                      </p>
                    </>
                  )}
                  {n.status === "SENT" && n.sentAt && (
                    <p className="mt-1 text-xs text-muted-foreground">{timeAgo(n.sentAt)}</p>
                  )}
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
                <TableCell className="text-right">
                  {canRetry && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={retrying !== null}
                      onClick={() => onRetryEmail(n.id)}
                      aria-label={`Retry email to ${n.recipientEmail ?? "recipient"}`}
                    >
                      <RotateCw className={cn(retrying === n.id && "animate-spin")} aria-hidden /> Retry
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function retryMessage(r: RetryResponse): string {
  if (r.attempted === 0) return "Nothing to retry — already handled or out of attempts";
  const parts: string[] = [];
  if (r.sent) parts.push(`${r.sent} sent`);
  if (r.simulated) parts.push(`${r.simulated} simulated`);
  if (r.failed) parts.push(`${r.failed} failed again`);
  if (r.skipped) parts.push(`${r.skipped} skipped`);
  return `Retried ${r.attempted} email${r.attempted === 1 ? "" : "s"}: ${parts.join(", ") || "done"}`;
}

// ── main view ────────────────────────────────────────────────

export function NotificationsView() {
  const session = useAppStore((s) => s.session);
  const isAdmin = session?.role === "ADMIN";

  const inApp = useApiData<{ items: NotificationItem[]; unread: number }>("/api/notifications");
  const email = useApiData<EmailOutboxResponse>(
    isAdmin ? "/api/notifications?channel=EMAIL" : null,
  );
  const [markingAll, setMarkingAll] = useState(false);
  // id of the email being retried, "all" for retry-all, null when idle
  const [retrying, setRetrying] = useState<string | null>(null);

  const retryEmails = async (target: string) => {
    setRetrying(target);
    try {
      const r = await api.post<RetryResponse>(
        "/api/notifications/retry",
        target === "all" ? { allFailed: true } : { ids: [target] },
      );
      if (r.failed > 0) toast.error(retryMessage(r));
      else toast.success(retryMessage(r));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to retry emails");
    } finally {
      setRetrying(null);
      email.reload();
    }
  };

  const unread = inApp.data?.unread ?? 0;
  const failedRetryable = email.data?.failedRetryable ?? 0;

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await api.post("/api/notifications/read", { all: true });
      toast.success("All notifications marked as read");
      useAppStore.getState().bump(); // refreshes this list and the header bell
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to mark notifications");
    } finally {
      setMarkingAll(false);
    }
  };

  const openNotification = (n: NotificationItem) => {
    if (!n.readAt) {
      // Fire-and-forget: navigation must not wait on (or fail with) marking read.
      api
        .post("/api/notifications/read", { ids: [n.id] })
        .then(() => useAppStore.getState().bump())
        .catch(() => {
          /* stays unread — non-critical */
        });
    }
    if (!n.deliveryId) return;
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
      onOpen={openNotification}
      onRetry={inApp.reload}
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
          <EmailModeBanner status={email.data?.emailStatus ?? null} />
          {failedRetryable > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {failedRetryable} failed email{failedRetryable === 1 ? "" : "s"} can be retried.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={retrying !== null}
                onClick={() => void retryEmails("all")}
              >
                <RotateCw className={cn(retrying === "all" && "animate-spin")} aria-hidden /> Retry all
                failed
              </Button>
            </div>
          )}
          <EmailOutbox
            items={email.data?.items ?? []}
            maxAttempts={email.data?.maxAttempts ?? 3}
            loading={email.loading}
            error={email.error}
            retrying={retrying}
            onRetry={email.reload}
            onRetryEmail={(id) => void retryEmails(id)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default NotificationsView;
