"use client";

import { Star } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportData } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Reports: customer ratings from the tracking page — average, count and 1–5 distribution. */
export function CustomerRatingsCard({ ratings }: { ratings: ReportData["ratings"] }) {
  const count = ratings?.count ?? 0;
  const dist = ratings?.distribution ?? [0, 0, 0, 0, 0];
  const max = Math.max(1, ...dist);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Customer ratings</CardTitle>
        <CardDescription className="text-xs">From recipients&apos; tracking pages, for deliveries in this range</CardDescription>
      </CardHeader>
      <CardContent>
        {count === 0 || !ratings ? (
          <div className="flex h-[120px] items-center justify-center text-center text-sm text-muted-foreground">
            No ratings yet. Recipients can rate a delivery for 14 days after it arrives.
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
            <div className="flex flex-col items-start gap-1">
              <p className="text-4xl font-semibold tracking-tight tabular-nums">
                {ratings.average?.toFixed(1)}
                <span className="text-base font-normal text-muted-foreground"> / 5</span>
              </p>
              <span className="inline-flex gap-0.5" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={cn("size-4", n <= Math.round(ratings.average ?? 0) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")}
                  />
                ))}
              </span>
              <p className="text-xs text-muted-foreground tabular-nums">
                {count} {count === 1 ? "rating" : "ratings"}
              </p>
            </div>
            <ul className="flex flex-col gap-1.5" aria-label="Ratings by stars">
              {[5, 4, 3, 2, 1].map((stars) => {
                const n = dist[stars - 1];
                return (
                  <li key={stars} className="flex items-center gap-2 text-xs">
                    <span className="w-10 shrink-0 tabular-nums text-muted-foreground">{stars} star</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${(n / max) * 100}%` }} />
                    </div>
                    <span className="w-14 shrink-0 text-right tabular-nums">
                      {n} <span className="text-muted-foreground">· {Math.round((n / count) * 100)}%</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
