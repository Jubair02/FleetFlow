"use client";

import { useState } from "react";
import { Building2, ScrollText, Search, X } from "lucide-react";
import { formatDateTime, timeAgo } from "@/lib/format";
import type { Paged, PlatformAuditRow } from "@/lib/platform-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConsole } from "./console-context";
import { useDebounced, usePlatformData, withQuery } from "./platform-api";
import { EmptyState, ErrorState, humanizeAction, PageHeader, PaginationBar, parseDetail, shortId, TableSkeleton } from "./shared";
import { OrgPicker } from "./users-view";

function Detail({ detail }: { detail: string | null }) {
  const parsed = parseDetail(detail);
  if (!parsed) return <span className="text-muted-foreground">—</span>;
  if (typeof parsed === "string") return <span className="break-words text-xs text-muted-foreground">{parsed}</span>;
  if (parsed.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
      {parsed.map((d) => (
        <div key={d.key} className="contents">
          <dt className="text-muted-foreground">{d.key}</dt>
          <dd className="min-w-0 break-words">{d.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AuditView() {
  const { auditOrgFilter, setAuditOrgFilter, openOrg } = useConsole();
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [seenActions, setSeenActions] = useState<string[]>([]);
  const debouncedAction = useDebounced(action.trim(), 300);

  const url = withQuery("/api/platform/audit", { action: debouncedAction, organizationId: auditOrgFilter?.id, page });
  const { data, loading, error, reload } = usePlatformData<Paged<PlatformAuditRow>>(url);
  const filtered = !!debouncedAction || !!auditOrgFilter;

  // Remember action names we've seen so the filter can suggest them (state updated during render, guarded).
  if (data) {
    const fresh = data.items.map((i) => i.action).filter((a) => !seenActions.includes(a));
    if (fresh.length) setSeenActions((prev) => Array.from(new Set([...prev, ...fresh])).sort());
  }

  return (
    <div>
      <PageHeader title="Audit Logs" description="Every action taken in the platform console, newest first. Entries cannot be edited or deleted." />
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
              placeholder="Filter by action…"
              className="pl-9"
              aria-label="Filter by action"
              list="platform-audit-actions"
              maxLength={60}
            />
            <datalist id="platform-audit-actions">
              {seenActions.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
          <OrgPicker
            value={auditOrgFilter}
            onChange={(o) => {
              setAuditOrgFilter(o);
              setPage(1);
            }}
          />
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAction("");
                setAuditOrgFilter(null);
                setPage(1);
              }}
            >
              <X aria-hidden /> Clear
            </Button>
          )}
        </div>

        {error && !data ? (
          <div className="p-4">
            <ErrorState title="Couldn't load the audit log" message={error} onRetry={reload} />
          </div>
        ) : !data ? (
          <TableSkeleton />
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={filtered ? "No entries match these filters" : "No platform actions yet"}
            description={filtered ? "Try a different action or organization." : "Sign-ins, suspensions, plan changes and resets will be listed here."}
          />
        ) : (
          <>
            {error && (
              <div className="p-3">
                <ErrorState title="Showing the last loaded page" message={error} onRetry={reload} />
              </div>
            )}
            <Table className={loading ? "opacity-60 transition-opacity" : undefined} aria-busy={loading}>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead className="min-w-56">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((row) => (
                  <TableRow key={row.id} className="align-top">
                    <TableCell className="whitespace-nowrap">
                      <time dateTime={row.createdAt} className="text-sm">
                        {formatDateTime(row.createdAt)}
                      </time>
                      <div className="text-[11px] text-muted-foreground">{timeAgo(row.createdAt)}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{humanizeAction(row.action)}</div>
                      <code className="text-[11px] text-muted-foreground">{row.action}</code>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{row.actorName ?? <span className="text-muted-foreground">System</span>}</TableCell>
                    <TableCell className="max-w-48">
                      {row.organizationId ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openOrg(row.organizationId!)}
                            className="truncate text-left text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                          >
                            {row.organizationName ?? shortId(row.organizationId)}
                          </button>
                          {!auditOrgFilter && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6 shrink-0"
                              onClick={() => {
                                setAuditOrgFilter({ id: row.organizationId!, name: row.organizationName ?? shortId(row.organizationId!) });
                                setPage(1);
                              }}
                              aria-label={`Show only entries for ${row.organizationName ?? "this organization"}`}
                              title="Filter to this organization"
                            >
                              <Building2 className="size-3" aria-hidden />
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant="outline" className="font-normal text-muted-foreground">
                        {row.targetType}
                      </Badge>
                      {row.targetId && <div className="mt-0.5 font-mono text-[11px] text-muted-foreground" title={row.targetId}>{shortId(row.targetId)}</div>}
                    </TableCell>
                    <TableCell className="max-w-80">
                      <Detail detail={row.detail} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
        {data && data.total > 0 && (
          <PaginationBar page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} noun="entries" onPage={setPage} disabled={loading} />
        )}
      </Card>
    </div>
  );
}
