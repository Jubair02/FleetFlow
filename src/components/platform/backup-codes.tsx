"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * One-time display of super-admin backup codes (after enrolment or
 * regeneration). They are never shown again — the server only keeps hashes.
 */
export function BackupCodesPanel({ codes, email }: { codes: string[]; email: string | null }) {
  const [copied, setCopied] = useState(false);
  const text = [
    `FleetFlow platform console — backup codes${email ? ` for ${email}` : ""}`,
    `Generated ${new Date().toISOString().slice(0, 10)}. Each code works once.`,
    "",
    ...codes,
  ].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the codes are still on screen */
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text + "\n"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "fleetflow-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <ol className="grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-sm tabular-nums" aria-label="Backup codes">
        {codes.map((c) => (
          <li key={c} className="select-all">
            {c}
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={download}>
          <Download aria-hidden /> Download .txt
        </Button>
      </div>
    </div>
  );
}
