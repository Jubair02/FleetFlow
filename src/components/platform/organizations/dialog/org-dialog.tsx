"use client";

import { useState } from "react";
import { Ban, Check, Copy, CreditCard, MoreHorizontal, Pencil, PlayCircle, ReceiptText, ScrollText, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { PlatformOrgDetail } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConsole, type OrgDialogTab } from "../../console-context";
import { usePlatformData } from "../../platform-api";
import { ErrorState } from "../../shared";
import { orgUrl } from "../org-api";
import { DeleteOrgDialog, ReactivateOrgDialog, SuspendOrgDialog } from "../org-action-dialogs";
import { orgShortId } from "../org-list-utils";
import { OrgAvatar, PlanPill, StatusPill } from "../org-parts";
import { ActivitySkeleton, ActivityTab } from "./activity-tab";
import { ChangePlanDialog } from "./change-plan-dialog";
import { DeliveriesTab } from "./deliveries-tab";
import { EditOrgDialog } from "./edit-org-dialog";
import { FULL_ON_PHONE } from "./org-dialog-utils";
import { OverviewSkeleton, OverviewTab } from "./overview-tab";
import { SubscriptionDialog } from "./subscription-dialog";
import { SubscriptionSkeleton, SubscriptionTab } from "./subscription-tab";
import { UsersSkeleton, UsersTab } from "./users-tab";

export interface OrgDialogState {
  id: string;
  tab: OrgDialogTab;
  /** Bumped on every open so the dialog starts fresh (tab, nested dialogs). */
  seq: number;
}

const TABS: { value: OrgDialogTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "users", label: "Users" },
  { value: "subscription", label: "Subscription" },
  { value: "deliveries", label: "Deliveries" },
  { value: "activity", label: "Activity" },
];

/** Organization dialog — opened from any console view via openOrg(id, tab). */
export function OrgDialog({ state, onClose }: { state: OrgDialogState | null; onClose: () => void }) {
  return (
    <Dialog open={state !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn("flex max-h-[min(90dvh,880px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl lg:max-w-4xl", FULL_ON_PHONE)}
      >
        {state ? (
          <OrgDialogBody key={`${state.id}-${state.seq}`} orgId={state.id} initialTab={state.tab} onClose={onClose} />
        ) : (
          <DialogTitle className="sr-only">Organization</DialogTitle>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Nested = "edit" | "plan" | "subscription" | "suspend" | "reactivate" | "delete" | null;

function OrgDialogBody({ orgId, initialTab, onClose }: { orgId: string; initialTab: OrgDialogTab; onClose: () => void }) {
  const { showOrgUsers, showOrgAudit } = useConsole();
  const { data, error, reload } = usePlatformData<PlatformOrgDetail>(orgUrl(orgId));
  const [tab, setTab] = useState<OrgDialogTab>(initialTab);
  const [nested, setNested] = useState<{ kind: Nested; seq: number }>({ kind: null, seq: 0 });
  const open = (kind: Nested) => setNested((n) => ({ kind, seq: n.seq + 1 }));
  const closeNested = (o: boolean) => !o && setNested((n) => ({ ...n, kind: null }));

  const org = data?.organization;
  const ref = org ? { id: org.id, name: org.name } : null;

  /** Per-tab body: skeleton while the detail loads, error + retry if it failed. */
  const body = (render: (d: PlatformOrgDetail) => React.ReactNode, skeleton: React.ReactNode) =>
    data ? render(data) : error ? <ErrorState title="Couldn't load this organization" message={error} onRetry={reload} /> : skeleton;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as OrgDialogTab)} className="flex min-h-0 flex-1 flex-col gap-0">
      <header className="shrink-0 border-b px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="flex items-start gap-3 sm:gap-4">
          {org ? (
            <OrgAvatar id={org.id} name={org.name} className="size-12 rounded-xl text-base" />
          ) : (
            <Skeleton className="size-12 shrink-0 rounded-xl" />
          )}
          <div className="min-w-0 flex-1">
            {org ? (
              <>
                <DialogTitle className="truncate text-lg leading-tight font-semibold tracking-tight sm:text-xl">{org.name}</DialogTitle>
                <DialogDescription asChild>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <CopyRef id={org.id} />
                    {org.contactEmail && (
                      <>
                        <span aria-hidden>·</span>
                        <a href={`mailto:${org.contactEmail}`} className="truncate hover:text-foreground hover:underline">
                          {org.contactEmail}
                        </a>
                      </>
                    )}
                  </div>
                </DialogDescription>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <StatusPill status={org.status} />
                  <PlanPill code={data.planDetail.code} name={data.planDetail.name} inactive={!data.planDetail.active} />
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-2 pt-1" aria-busy={!error}>
                <DialogTitle className="sr-only">{error ? "Organization" : "Loading organization"}</DialogTitle>
                <DialogDescription className="sr-only">Organization details</DialogDescription>
                {error ? <span className="text-base font-semibold">Organization</span> : <Skeleton className="h-5 w-48" />}
                {!error && <Skeleton className="h-3.5 w-64 max-w-full" />}
              </div>
            )}
          </div>
          <div className="-mr-2 -mt-1.5 flex shrink-0 items-center gap-1 sm:-mr-3">
            {data && (
              <>
                <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => open("edit")}>
                  <Pencil aria-hidden /> Edit
                </Button>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-11 sm:size-9" aria-label={`More actions for ${data.organization.name}`}>
                      <MoreHorizontal className="size-4" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onSelect={() => open("edit")}>
                      <Pencil aria-hidden /> Edit organization
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => open("plan")}>
                      <CreditCard aria-hidden /> Change plan
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => open("subscription")}>
                      <ReceiptText aria-hidden /> Edit subscription
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => ref && showOrgAudit(ref)}>
                      <ScrollText aria-hidden /> Platform audit log
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {data.organization.status === "SUSPENDED" ? (
                      <DropdownMenuItem onSelect={() => open("reactivate")}>
                        <PlayCircle aria-hidden /> Reactivate organization
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem variant="destructive" onSelect={() => open("suspend")}>
                        <Ban aria-hidden /> Suspend organization
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => open("delete")}>
                      <Trash2 aria-hidden /> Delete organization
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            <Button variant="ghost" size="icon" className="size-11 sm:size-9" onClick={onClose} aria-label="Close">
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        <TabsList
          className="mt-3 h-auto w-full justify-start gap-1 overflow-x-auto overflow-y-hidden rounded-none bg-transparent p-0 [scrollbar-width:none] sm:mt-4 [&::-webkit-scrollbar]:hidden"
          aria-label="Organization sections"
        >
          {TABS.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="h-11 flex-none rounded-none border-0 border-b-2 border-transparent px-3 text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none sm:h-10 dark:text-muted-foreground dark:data-[state=active]:border-primary dark:data-[state=active]:bg-transparent"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6">
        {error && data && (
          <div className="mb-4">
            <ErrorState title="Showing the last loaded details" message={error} onRetry={reload} />
          </div>
        )}
        <TabsContent value="overview">{body((d) => <OverviewTab detail={d} />, <OverviewSkeleton />)}</TabsContent>
        <TabsContent value="users">
          {body(
            (d) => (
              <UsersTab detail={d} onManageUsers={() => showOrgUsers({ id: d.organization.id, name: d.organization.name })} />
            ),
            <UsersSkeleton />
          )}
        </TabsContent>
        <TabsContent value="subscription">
          {body(
            (d) => (
              <SubscriptionTab detail={d} onChangePlan={() => open("plan")} onEditSubscription={() => open("subscription")} />
            ),
            <SubscriptionSkeleton />
          )}
        </TabsContent>
        <TabsContent value="deliveries">
          <DeliveriesTab orgId={orgId} />
        </TabsContent>
        <TabsContent value="activity">
          {body(
            (d) => (
              <ActivityTab detail={d} onOpenAudit={() => showOrgAudit({ id: d.organization.id, name: d.organization.name })} />
            ),
            <ActivitySkeleton />
          )}
        </TabsContent>
      </div>

      {data && (
        <>
          <EditOrgDialog key={`e-${nested.seq}`} open={nested.kind === "edit"} onOpenChange={closeNested} orgId={orgId} detail={data} />
          <ChangePlanDialog key={`p-${nested.seq}`} open={nested.kind === "plan"} onOpenChange={closeNested} orgId={orgId} detail={data} />
          <SubscriptionDialog key={`sub-${nested.seq}`} open={nested.kind === "subscription"} onOpenChange={closeNested} orgId={orgId} detail={data} />
          <SuspendOrgDialog key={`s-${nested.seq}`} open={nested.kind === "suspend"} org={ref} onOpenChange={closeNested} />
          <ReactivateOrgDialog key={`r-${nested.seq}`} open={nested.kind === "reactivate"} org={ref} onOpenChange={closeNested} />
          <DeleteOrgDialog
            key={`d-${nested.seq}`}
            open={nested.kind === "delete"}
            org={ref}
            onOpenChange={closeNested}
            onSuspendInstead={() => open("suspend")}
            onDeleted={onClose}
          />
        </>
      )}
    </Tabs>
  );
}

/** "ORG-A1B2C3" reference with a copy-the-full-id button. */
function CopyRef({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select the ID and copy it manually");
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={id}
      className="-mx-1 inline-flex min-h-6 items-center gap-1 rounded px-1 font-mono text-[11px] tracking-tight hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      aria-label={copied ? "Organization ID copied" : `Copy organization ID ${id}`}
    >
      {orgShortId(id)}
      {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
    </button>
  );
}
