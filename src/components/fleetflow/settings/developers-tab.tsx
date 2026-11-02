"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  Copy,
  CreditCard,
  Eye,
  KeyRound,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  Send,
  ShieldCheck,
  Trash2,
  Webhook,
} from "lucide-react";

import { UpgradeExplainer } from "@/components/fleetflow/plan-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, useApiData } from "@/lib/api-client";
import {
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_EVENTS,
  type ApiKeyItem,
  type CreatedApiKey,
  type DevelopersOverview,
  type WebhookDeliveryItem,
  type WebhookDeliveryStatus,
  type WebhookEndpointItem,
  type WebhookEventType,
  type WebhookTestResult,
} from "@/lib/developers";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { goToSettings } from "@/store/app-store";
import { IconChip, LoadError, PANEL, ServerError } from "./shared";

// ─────────────────────────────────────────────────────────────
// Settings → API & webhooks (admin). Keys and endpoints are managed through
// /api/developers/**; the public API itself is documented in docs/API.md.
// ─────────────────────────────────────────────────────────────

const DANGER_ACTION = "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/30 dark:bg-rose-600 dark:hover:bg-rose-700";
const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

function useCopy(label: string) {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the text and copy it manually");
    }
  };
  return { copied, copy };
}

function SecretBox({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopy(label);
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
      <code className="min-w-0 flex-1 select-all break-all font-mono text-sm" aria-label={label}>
        {value}
      </code>
      <Button type="button" variant="outline" size="sm" onClick={() => void copy(value)} className="shrink-0">
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

const DELIVERY_TONE: Record<WebhookDeliveryStatus, string> = {
  SUCCEEDED: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  PENDING: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  SENDING: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  FAILED: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
};
const DELIVERY_LABEL: Record<WebhookDeliveryStatus, string> = { SUCCEEDED: "Delivered", PENDING: "Retrying", SENDING: "Sending", FAILED: "Failed" };

function DeliveryBadge({ status, responseStatus }: { status: WebhookDeliveryStatus; responseStatus: number | null }) {
  return (
    <Badge variant="outline" className={DELIVERY_TONE[status]}>
      {DELIVERY_LABEL[status]}
      {responseStatus ? ` · ${responseStatus}` : ""}
    </Badge>
  );
}

// ── API keys ─────────────────────────────────────────────────

function CreateKeyDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError("Name the key, e.g. “WooCommerce store”");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<CreatedApiKey>("/api/developers/keys", { name: name.trim() });
      setCreated(res);
      onCreated();
    } catch (err) {
      setError(errorMessage(err, "Failed to create the key"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <div className="mb-1 flex items-center gap-3">
                <IconChip icon={KeyRound} />
                <DialogTitle>Copy your new API key</DialogTitle>
              </div>
              <DialogDescription>
                <span className="font-medium text-foreground">{created.key.name}</span> — send it as{" "}
                <code className="font-mono text-xs">Authorization: Bearer …</code>
              </DialogDescription>
            </DialogHeader>
            <SecretBox value={created.secret} label="API key" />
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              This is the only time the key is shown. Store it in your store&apos;s or system&apos;s settings now — anyone with it can create
              and read your deliveries. If it leaks, revoke it and create a new one.
            </p>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)} className="min-h-11 sm:min-h-9">
                I&apos;ve saved it
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="mb-1 flex items-center gap-3">
                <IconChip icon={KeyRound} />
                <DialogTitle>Create an API key</DialogTitle>
              </div>
              <DialogDescription>Use one key per store or system, so you can revoke one without breaking the others.</DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="api-key-name">Key name</Label>
                <Input
                  id="api-key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  placeholder="e.g. WooCommerce store"
                  autoComplete="off"
                />
              </div>
              <ServerError message={error} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} className="min-h-11 sm:min-h-9">
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="min-h-11 sm:min-h-9">
                  {submitting ? "Creating…" : "Create key"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ApiKeysSection({ keys, locked, reload }: { keys: ApiKeyItem[]; locked: boolean; reload: () => void }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createSeq, setCreateSeq] = useState(0);
  const [revoking, setRevoking] = useState<ApiKeyItem | null>(null);
  const [busy, setBusy] = useState(false);
  const active = keys.filter((k) => !k.revokedAt).length;

  const revoke = async (key: ApiKeyItem) => {
    setBusy(true);
    try {
      await api.del(`/api/developers/keys/${key.id}`);
      toast.success(`“${key.name}” revoked — requests with it are refused from now on`);
      setRevoking(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to revoke the key"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={PANEL} aria-labelledby="api-keys-title">
      <header className="flex flex-col gap-4 border-b px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <IconChip icon={KeyRound} />
          <div className="min-w-0">
            <h3 id="api-keys-title" className="text-base font-semibold">
              API keys
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Let your online store or other systems create and track deliveries{active ? ` · ${active} active` : ""}.
            </p>
          </div>
        </div>
        <Button
          onClick={() => {
            setCreateSeq((n) => n + 1);
            setCreateOpen(true);
          }}
          disabled={locked}
          className="min-h-11 shrink-0 sm:min-h-9"
        >
          <Plus aria-hidden /> Create key
        </Button>
      </header>

      {keys.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted">
            <KeyRound className="size-6 text-muted-foreground" aria-hidden />
          </span>
          <p className="text-sm font-medium">No API keys yet</p>
          <p className="text-xs text-muted-foreground">Create one for each store or system you want to connect.</p>
        </div>
      ) : (
        <ul className="divide-y" aria-label="API keys">
          {keys.map((k) => (
            <li key={k.id} className={cn("flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6", k.revokedAt && "bg-muted/20")}>
              <div className={cn("min-w-0 flex-1", k.revokedAt && "opacity-70")}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{k.name}</span>
                  {k.revokedAt ? (
                    <Badge variant="outline" className="border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
                      Revoked {formatDate(k.revokedAt)}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                      Active
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <code className="font-mono">{k.prefix}…</code> · created {formatDate(k.createdAt)}
                  {k.createdByName ? ` by ${k.createdByName}` : ""}
                </p>
              </div>
              <p className="shrink-0 text-xs text-muted-foreground sm:w-36">{k.lastUsedAt ? `Used ${timeAgo(k.lastUsedAt)}` : "Never used"}</p>
              <div className="shrink-0 sm:w-28 sm:text-right">
                {!k.revokedAt && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRevoking(k)}
                    className="min-h-11 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 sm:min-h-8 dark:hover:border-rose-900 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                  >
                    <Ban aria-hidden /> Revoke
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <CreateKeyDialog key={`create-key-${createSeq}`} open={createOpen} onOpenChange={setCreateOpen} onCreated={reload} />

      <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && !busy && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{revoking?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Every request made with this key will be refused immediately. Anything connected with it stops creating deliveries until
              you give it a new key. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 sm:min-h-9" disabled={busy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className={DANGER_ACTION}
              onClick={(e) => {
                e.preventDefault();
                if (revoking) void revoke(revoking);
              }}
            >
              {busy ? "Revoking…" : "Revoke key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ── webhook endpoints ────────────────────────────────────────

const DEFAULT_EVENTS: WebhookEventType[] = ["delivery.status_changed"];

function EndpointDialog({
  open,
  onOpenChange,
  endpoint,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** null = add a new endpoint */
  endpoint: WebhookEndpointItem | null;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState(endpoint?.url ?? "");
  const [description, setDescription] = useState(endpoint?.description ?? "");
  const [events, setEvents] = useState<WebhookEventType[]>(endpoint?.events ?? DEFAULT_EVENTS);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggle = (e: WebhookEventType, on: boolean) => setEvents((list) => (on ? [...list, e] : list.filter((x) => x !== e)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return setError("Enter the URL that should receive webhooks");
    if (!events.length) return setError("Choose at least one event");
    setSubmitting(true);
    setError(null);
    try {
      const body = { url: url.trim(), description: description.trim(), events };
      if (endpoint) await api.patch(`/api/developers/webhooks/${endpoint.id}`, body);
      else await api.post("/api/developers/webhooks", body);
      toast.success(endpoint ? "Endpoint updated" : "Endpoint added — send a test event to check it");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, "Failed to save the endpoint"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-3">
            <IconChip icon={Webhook} />
            <DialogTitle>{endpoint ? "Edit endpoint" : "Add a webhook endpoint"}</DialogTitle>
          </div>
          <DialogDescription>FleetFlow will POST a signed JSON event to this URL whenever one of the chosen events happens.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="webhook-url">Endpoint URL</Label>
            <Input
              id="webhook-url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={2048}
              placeholder="https://shop.example.com/fleetflow/webhook"
              autoComplete="off"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">Must be a public https:// address.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="webhook-description">
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="webhook-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              placeholder="e.g. WooCommerce order updates"
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium">Events</legend>
            {WEBHOOK_EVENT_TYPES.map((ev) => (
              <label
                key={ev}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors hover:bg-muted/50",
                  events.includes(ev) && "border-primary/40 bg-primary/5",
                )}
              >
                <Checkbox checked={events.includes(ev)} onCheckedChange={(v) => toggle(ev, v === true)} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {WEBHOOK_EVENTS[ev].label} <code className="ml-1 font-mono text-xs font-normal text-muted-foreground">{ev}</code>
                  </span>
                  <span className="block text-xs text-muted-foreground">{WEBHOOK_EVENTS[ev].description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <ServerError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} className="min-h-11 sm:min-h-9">
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="min-h-11 sm:min-h-9">
              {submitting ? "Saving…" : endpoint ? "Save changes" : "Add endpoint"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SecretDialog({ endpoint, onClose }: { endpoint: WebhookEndpointItem | null; onClose: () => void }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reveal" | "rotate" | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const run = async (action: "reveal" | "rotate") => {
    if (!endpoint) return;
    setBusy(action);
    try {
      const res = await api.post<{ secret: string }>(`/api/developers/webhooks/${endpoint.id}/secret`, { action });
      setSecret(res.secret);
      setConfirmRotate(false);
      if (action === "rotate") toast.success("New signing secret created — update your receiver now");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to load the secret"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={endpoint !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-3">
            <IconChip icon={ShieldCheck} />
            <DialogTitle>Signing secret</DialogTitle>
          </div>
          <DialogDescription>
            Your receiver uses this secret to check the <code className="font-mono text-xs">FleetFlow-Signature</code> header, so it knows a
            request really came from FleetFlow.
          </DialogDescription>
        </DialogHeader>
        {secret ? (
          <SecretBox value={secret} label="Signing secret" />
        ) : (
          <Button type="button" variant="outline" onClick={() => void run("reveal")} disabled={!!busy} className="min-h-11 sm:min-h-9">
            <Eye aria-hidden /> {busy === "reveal" ? "Loading…" : "Reveal secret"}
          </Button>
        )}
        {confirmRotate ? (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <p>The current secret stops working immediately — events will fail signature checks until your receiver has the new one.</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setConfirmRotate(false)} disabled={!!busy}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => void run("rotate")} disabled={!!busy}>
                {busy === "rotate" ? "Rotating…" : "Rotate now"}
              </Button>
            </div>
          </div>
        ) : null}
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => setConfirmRotate(true)} disabled={!!busy || confirmRotate} className="min-h-11 sm:min-h-9">
            <RotateCw aria-hidden /> Rotate secret
          </Button>
          <Button type="button" onClick={onClose} disabled={!!busy} className="min-h-11 sm:min-h-9">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecentDeliveries({ endpoint, locked }: { endpoint: WebhookEndpointItem; locked: boolean }) {
  const { data, loading, error, reload } = useApiData<{ items: WebhookDeliveryItem[] }>(`/api/developers/webhooks/${endpoint.id}/deliveries`);
  const [retrying, setRetrying] = useState<string | null>(null);

  const retry = async (d: WebhookDeliveryItem) => {
    setRetrying(d.id);
    try {
      const res = await api.post<{ delivery: WebhookDeliveryItem }>(`/api/developers/webhook-deliveries/${d.id}/retry`);
      if (res.delivery.status === "SUCCEEDED") toast.success("Delivered");
      else toast.error(`Still failing${res.delivery.lastError ? `: ${res.delivery.lastError.slice(0, 120)}` : ""}`);
      void reload();
    } catch (err) {
      toast.error(errorMessage(err, "Retry failed"));
    } finally {
      setRetrying(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-2 px-5 pb-4 sm:px-6" aria-busy="true">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="px-5 pb-4 sm:px-6">
        <LoadError what="recent deliveries" error={error} onRetry={() => void reload()} />
      </div>
    );
  }
  const items = data?.items ?? [];
  return (
    <div className="px-5 pb-4 sm:px-6">
      <div className="rounded-xl border">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground">Recent deliveries</p>
          <Button variant="ghost" size="sm" onClick={() => void reload()} className="h-7 px-2 text-xs">
            <RefreshCw aria-hidden /> Refresh
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">Nothing sent yet. Use “Send test event” to try the endpoint.</p>
        ) : (
          <ul className="divide-y text-xs" aria-label="Recent webhook deliveries">
            {items.map((d) => (
              <li key={d.id} className="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <DeliveryBadge status={d.status} responseStatus={d.responseStatus} />
                  <code className="font-mono">{d.event}</code>
                  <span className="text-muted-foreground" title={formatDateTime(d.lastAttemptAt ?? d.createdAt)}>
                    {timeAgo(d.lastAttemptAt ?? d.createdAt)} · {d.attempts} attempt{d.attempts === 1 ? "" : "s"}
                    {d.nextAttemptAt ? ` · next ${formatDateTime(d.nextAttemptAt)}` : ""}
                  </span>
                  {d.lastError && d.status !== "SUCCEEDED" && (
                    <span className="w-full truncate text-rose-700 dark:text-rose-300" title={d.lastError}>
                      {d.lastError}
                    </span>
                  )}
                </div>
                {(d.status === "FAILED" || d.status === "PENDING") && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 self-start px-2 text-xs sm:self-auto"
                    disabled={locked || !endpoint.active || retrying !== null}
                    onClick={() => void retry(d)}
                  >
                    <RotateCw aria-hidden /> {retrying === d.id ? "Sending…" : "Retry now"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EndpointRow({
  endpoint,
  locked,
  onEdit,
  onSecret,
  onDelete,
  reload,
}: {
  endpoint: WebhookEndpointItem;
  locked: boolean;
  onEdit: () => void;
  onSecret: () => void;
  onDelete: () => void;
  reload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [historySeq, setHistorySeq] = useState(0);

  const test = async () => {
    setBusy(true);
    try {
      const res = await api.post<WebhookTestResult>(`/api/developers/webhooks/${endpoint.id}/test`);
      const d = res.delivery;
      if (d.status === "SUCCEEDED") toast.success(`Test event delivered (HTTP ${d.responseStatus})`);
      else toast.error(`Test event failed${d.lastError ? `: ${d.lastError.slice(0, 160)}` : ""}`);
      setOpen(true);
      setHistorySeq((n) => n + 1);
      reload();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to send the test event"));
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (active: boolean) => {
    setBusy(true);
    try {
      await api.patch(`/api/developers/webhooks/${endpoint.id}`, { active });
      toast.success(active ? "Endpoint enabled" : "Endpoint disabled — no events will be sent to it");
      reload();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update the endpoint"));
    } finally {
      setBusy(false);
    }
  };

  const autoDisabled = !endpoint.active && endpoint.disabledReason?.startsWith("Disabled automatically");
  return (
    <li className={cn(!endpoint.active && "bg-muted/20")}>
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:px-6">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate font-mono text-sm font-medium" title={endpoint.url}>
              {endpoint.url}
            </span>
            {endpoint.active ? (
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                Active
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className={
                  autoDisabled
                    ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                    : "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300"
                }
              >
                {autoDisabled ? "Disabled after failures" : "Disabled"}
              </Badge>
            )}
          </div>
          {endpoint.description && <p className="text-xs text-muted-foreground">{endpoint.description}</p>}
          <div className="flex flex-wrap gap-1">
            {endpoint.events.map((ev) => (
              <code key={ev} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {ev}
              </code>
            ))}
          </div>
          {!endpoint.active && endpoint.disabledReason && (
            <p className="text-xs text-muted-foreground">
              {endpoint.disabledReason}
              {endpoint.disabledAt ? ` · ${formatDateTime(endpoint.disabledAt)}` : ""}
            </p>
          )}
          {endpoint.active && endpoint.consecutiveFailures > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-3.5" aria-hidden="true" /> {endpoint.consecutiveFailures} failed attempt
              {endpoint.consecutiveFailures === 1 ? "" : "s"} in a row
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {endpoint.lastDelivery && <DeliveryBadge status={endpoint.lastDelivery.status} responseStatus={endpoint.lastDelivery.responseStatus} />}
          <Button variant="outline" size="sm" disabled={locked || busy || !endpoint.active} onClick={() => void test()} className="min-h-11 sm:min-h-8">
            <Send aria-hidden /> {busy ? "Sending…" : "Send test event"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-11 sm:size-8" aria-label={`Actions for ${endpoint.url}`} disabled={busy}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit} disabled={locked}>
                <Pencil aria-hidden /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onSecret} disabled={locked}>
                <ShieldCheck aria-hidden /> Signing secret
              </DropdownMenuItem>
              {endpoint.active ? (
                <DropdownMenuItem onSelect={() => void setActive(false)}>
                  <Power aria-hidden /> Disable
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => void setActive(true)} disabled={locked}>
                  <Power aria-hidden /> Enable
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDelete} variant="destructive">
                <Trash2 aria-hidden /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-5 pb-3 text-xs font-medium text-muted-foreground hover:text-foreground sm:px-6"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
        {open ? "Hide recent deliveries" : "Show recent deliveries"}
      </button>
      {open && <RecentDeliveries key={historySeq} endpoint={endpoint} locked={locked} />}
    </li>
  );
}

function WebhooksSection({ endpoints, locked, reload }: { endpoints: WebhookEndpointItem[]; locked: boolean; reload: () => void }) {
  const [editing, setEditing] = useState<{ endpoint: WebhookEndpointItem | null; seq: number } | null>(null);
  const [secretFor, setSecretFor] = useState<WebhookEndpointItem | null>(null);
  const [deleting, setDeleting] = useState<WebhookEndpointItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [seq, setSeq] = useState(0);

  const openEditor = (endpoint: WebhookEndpointItem | null) => {
    setSeq((n) => n + 1);
    setEditing({ endpoint, seq: seq + 1 });
  };

  const remove = async (endpoint: WebhookEndpointItem) => {
    setBusy(true);
    try {
      await api.del(`/api/developers/webhooks/${endpoint.id}`);
      toast.success("Endpoint deleted");
      setDeleting(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete the endpoint"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={PANEL} aria-labelledby="webhooks-title">
      <header className="flex flex-col gap-4 border-b px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <IconChip icon={Webhook} />
          <div className="min-w-0">
            <h3 id="webhooks-title" className="text-base font-semibold">
              Webhook endpoints
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Get notified the moment a delivery is created, assigned, delivered or fails. Failed calls are retried for about a day.
            </p>
          </div>
        </div>
        <Button onClick={() => openEditor(null)} disabled={locked} className="min-h-11 shrink-0 sm:min-h-9">
          <Plus aria-hidden /> Add endpoint
        </Button>
      </header>

      {endpoints.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted">
            <Webhook className="size-6 text-muted-foreground" aria-hidden />
          </span>
          <p className="text-sm font-medium">No endpoints yet</p>
          <p className="text-xs text-muted-foreground">Add your store&apos;s webhook URL to receive delivery updates.</p>
        </div>
      ) : (
        <ul className="divide-y" aria-label="Webhook endpoints">
          {endpoints.map((e) => (
            <EndpointRow
              key={e.id}
              endpoint={e}
              locked={locked}
              onEdit={() => openEditor(e)}
              onSecret={() => setSecretFor(e)}
              onDelete={() => setDeleting(e)}
              reload={reload}
            />
          ))}
        </ul>
      )}

      {editing && (
        <EndpointDialog
          key={`endpoint-${editing.seq}`}
          open
          endpoint={editing.endpoint}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={reload}
        />
      )}
      <SecretDialog key={secretFor?.id ?? "none"} endpoint={secretFor} onClose={() => setSecretFor(null)} />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && !busy && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this endpoint?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="break-all font-mono text-xs">{deleting?.url}</span> will stop receiving events, and its delivery history is
              removed. Queued retries are dropped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 sm:min-h-9" disabled={busy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className={DANGER_ACTION}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) void remove(deleting);
              }}
            >
              {busy ? "Deleting…" : "Delete endpoint"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ── tab ──────────────────────────────────────────────────────

function ConnectionCard({ baseUrl }: { baseUrl: string }) {
  const { copied, copy } = useCopy("API base URL");
  return (
    <section className={cn(PANEL, "flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:px-6")} aria-labelledby="api-base-title">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <IconChip icon={Link2} />
        <div className="min-w-0">
          <h3 id="api-base-title" className="text-base font-semibold">
            REST API
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Send <code className="font-mono">Authorization: Bearer &lt;API key&gt;</code> with every request · 120 requests per minute per key.
          </p>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-3">
        <code className="min-w-0 truncate font-mono text-sm">{baseUrl}</code>
        <Button type="button" variant="ghost" size="sm" onClick={() => void copy(baseUrl)} className="shrink-0" aria-label="Copy API base URL">
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </Button>
      </div>
    </section>
  );
}

export function DevelopersTab() {
  const { data, loading, error, reload } = useApiData<DevelopersOverview>("/api/developers");
  const refresh = () => void reload();

  if (loading && !data) {
    return (
      <div className="space-y-4" aria-busy="true">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className={cn(PANEL, "space-y-3 p-6")}>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-12 w-full" />
          </div>
        ))}
      </div>
    );
  }
  if (!data) return <LoadError what="API settings" error={error ?? "Unknown error"} onRetry={refresh} />;

  const locked = !data.apiAccess;
  const hasLegacy = data.keys.some((k) => !k.revokedAt) || data.endpoints.length > 0;
  return (
    <div className="space-y-4">
      {locked ? (
        <section className={cn(PANEL, "space-y-4 p-5 sm:p-6")} aria-label="Upgrade to use the API">
          <UpgradeExplainer feature="api_access" planName={data.planName} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => goToSettings("plan")} className="min-h-11 sm:min-h-9">
              <CreditCard aria-hidden="true" /> See plans
            </Button>
            {hasLegacy && (
              <p className="text-xs text-muted-foreground">Existing keys and endpoints below are paused — you can still revoke or delete them.</p>
            )}
          </div>
        </section>
      ) : (
        <ConnectionCard baseUrl={data.apiBaseUrl} />
      )}
      {(!locked || hasLegacy) && (
        <>
          <ApiKeysSection keys={data.keys} locked={locked} reload={refresh} />
          <WebhooksSection endpoints={data.endpoints} locked={locked} reload={refresh} />
        </>
      )}
      <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        Only admins can see this page. Creating or revoking keys and changing endpoints is recorded in the audit log.
      </p>
    </div>
  );
}
