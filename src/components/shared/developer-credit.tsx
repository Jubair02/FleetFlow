import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

const PORTFOLIO_URL = "https://jhossain.vercel.app/";

// Hover/focus accent per shell: emerald for the company app, violet for the platform console.
const TONES = {
  emerald: "hover:text-emerald-700 focus-visible:text-emerald-700 dark:hover:text-emerald-400 dark:focus-visible:text-emerald-400",
  violet: "hover:text-violet-700 focus-visible:text-violet-700 dark:hover:text-violet-400 dark:focus-visible:text-violet-400",
} as const;

/**
 * "Built by Jubair Hossain" footer credit. Pure CSS motion: the name brightens
 * to the accent, an underline draws in from the left and an arrow slides up.
 */
export function DeveloperCredit({ tone = "emerald", className }: { tone?: keyof typeof TONES; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap", className)}>
      <span>Built by</span>
      <a
        href={PORTFOLIO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "group/credit -mx-1 -my-1 inline-flex items-center gap-0.5 rounded-md px-1 py-1 font-medium text-foreground/80 outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/60",
          TONES[tone],
        )}
      >
        <span className="relative">
          Jubair Hossain
          <span
            aria-hidden="true"
            className="absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 bg-current transition-transform duration-300 ease-out group-hover/credit:scale-x-100 group-focus-visible/credit:scale-x-100 motion-reduce:transition-none"
          />
        </span>
        <ArrowUpRight
          aria-hidden="true"
          className="size-3 translate-y-0.5 -translate-x-0.5 opacity-40 transition-[opacity,translate] duration-200 ease-out group-hover/credit:translate-0 group-hover/credit:opacity-100 group-focus-visible/credit:translate-0 group-focus-visible/credit:opacity-100 motion-reduce:transition-none"
        />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </span>
  );
}
