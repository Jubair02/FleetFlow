#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Change an organization's subscription plan (manual billing).
//
//   node scripts/set-plan.mjs --org <id|exact name> --plan starter|growth|business|trial [--dry-run]
//
// Prints the current plan and usage against the new plan's limits,
// warns when usage already exceeds them (existing data is NEVER
// deleted or disabled — only new additions get blocked), then sets
// Organization.plan and writes one AuditLog row (PLAN_CHANGED).
// No other writes. --dry-run prints everything and writes nothing.
//
// Plan limits are read from src/lib/plan-catalog.ts (single source of truth).
// See docs/BILLING.md for the manual billing process.
// ─────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ACTOR_NAME = "FleetFlow billing";
const RESOURCES = ["drivers", "vehicles", "admins", "monthlyDeliveries"];
const RESOURCE_LABELS = {
  drivers: "active drivers",
  vehicles: "vehicles in service",
  admins: "dispatcher/admin accounts",
  monthlyDeliveries: "deliveries this month",
};

function usage() {
  console.log(`Usage: node scripts/set-plan.mjs --org <id|exact name> --plan <code> [--dry-run]

  --org      Organization id, or its exact name
  --plan     New plan code (see src/lib/plan-catalog.ts)
  --dry-run  Show the change and usage check without writing anything`);
}

function parseArgs(argv) {
  const out = { org: "", plan: "", dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--org") out.org = (argv[++i] ?? "").trim();
    else if (a === "--plan") out.plan = (argv[++i] ?? "").trim().toLowerCase();
    else if (a.startsWith("--org=")) out.org = a.slice(6).trim();
    else if (a.startsWith("--plan=")) out.plan = a.slice(7).trim().toLowerCase();
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

/** Read plan names and limits from src/lib/plan-catalog.ts by parsing the source (no TS loader needed). */
function loadPlans() {
  const src = readFileSync(resolve(ROOT, "src/lib/plan-catalog.ts"), "utf8");
  const plans = {};
  const block = /code:\s*"(\w+)",\s*name:\s*"([^"]+)",\s*proposedPriceBdt:\s*(null|\d+),\s*limits:\s*\{([^}]*)\}/g;
  for (const m of src.matchAll(block)) {
    const limits = {};
    for (const pair of m[4].matchAll(/(\w+):\s*(null|\d+)/g)) limits[pair[1]] = pair[2] === "null" ? null : Number(pair[2]);
    plans[m[1]] = { code: m[1], name: m[2], proposedPriceBdt: m[3] === "null" ? null : Number(m[3]), limits };
  }
  for (const code of ["trial", "starter", "growth", "business"]) {
    const p = plans[code];
    if (!p || RESOURCES.some((r) => !(r in p.limits))) {
      throw new Error(`Could not read plan "${code}" from src/lib/plan-catalog.ts — has its format changed?`);
    }
  }
  return plans;
}

// ── Timezone (mirrors src/lib/timezone.ts → startOfMonthInTz) ──
function tzOffsetMinutes(instant, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}
function startOfMonthInTz(now, tz) {
  const local = new Date(now.getTime() + tzOffsetMinutes(now, tz) * 60_000);
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 0, 0);
  let utc = guess - tzOffsetMinutes(new Date(guess), tz) * 60_000;
  const corrected = tzOffsetMinutes(new Date(utc), tz);
  utc = guess - corrected * 60_000;
  return new Date(utc);
}

/** Same counts as getUsage() in src/lib/plans.ts. */
async function getUsage(db, organizationId, timezone) {
  const monthStart = startOfMonthInTz(new Date(), timezone || "Asia/Dhaka");
  const [drivers, vehicles, admins, monthlyDeliveries] = await Promise.all([
    db.user.count({ where: { organizationId, role: "DRIVER", active: true } }),
    db.vehicle.count({ where: { organizationId, status: { not: "INACTIVE" } } }),
    db.user.count({ where: { organizationId, role: "ADMIN", active: true } }),
    db.delivery.count({ where: { organizationId, createdAt: { gte: monthStart } } }),
  ]);
  return { drivers, vehicles, admins, monthlyDeliveries };
}

async function findOrg(db, ref) {
  const byId = await db.organization.findUnique({ where: { id: ref } });
  if (byId) return byId;
  const byName = await db.organization.findMany({ where: { name: ref } });
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new Error(`Several organizations are named "${ref}" — use the id instead:\n${byName.map((o) => `  ${o.id}  (${o.plan})`).join("\n")}`);
  }
  throw new Error(`No organization with id or exact name "${ref}"`);
}

const fmtLimit = (n) => (n === null ? "unlimited" : String(n));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.org || !args.plan) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const plans = loadPlans();
  const next = plans[args.plan];
  if (!next) throw new Error(`Unknown plan "${args.plan}". Choose one of: ${Object.keys(plans).join(", ")}`);

  if (!process.env.DATABASE_URL && existsSync(resolve(ROOT, ".env"))) process.loadEnvFile?.(resolve(ROOT, ".env"));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (and no .env found)");

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ log: ["error"] });
  try {
    const org = await findOrg(db, args.org);
    const current = plans[(org.plan || "trial").toLowerCase()] ?? plans.trial;
    const used = await getUsage(db, org.id, org.timezone);

    console.log(`Organization : ${org.name} (${org.id})`);
    console.log(`Current plan : ${current.name} [${org.plan}]`);
    console.log(`New plan     : ${next.name} [${next.code}]${next.proposedPriceBdt != null ? ` — proposed ৳${next.proposedPriceBdt}/month` : ""}`);
    console.log("");
    console.log("Usage vs limits (current → new):");
    const over = [];
    for (const r of RESOURCES) {
      const lim = next.limits[r];
      const exceeds = lim !== null && used[r] > lim;
      if (exceeds) over.push(r);
      console.log(
        `  ${RESOURCE_LABELS[r].padEnd(28)} ${String(used[r]).padStart(6)}   ${fmtLimit(current.limits[r]).padStart(9)} → ${fmtLimit(lim).padStart(9)}${exceeds ? "   ⚠ OVER" : ""}`
      );
    }
    if (over.length) {
      console.log("");
      console.warn(`WARNING: usage already exceeds the ${next.name} plan for: ${over.map((r) => RESOURCE_LABELS[r]).join(", ")}.`);
      console.warn("Existing data is kept untouched; only NEW additions of those resources will be refused until usage drops.");
    }

    if (org.plan === next.code) {
      console.log("\nNo change: the organization is already on this plan. Nothing written.");
      return;
    }
    if (args.dryRun) {
      console.log("\n--dry-run: nothing written.");
      return;
    }

    await db.$transaction([
      db.organization.update({ where: { id: org.id }, data: { plan: next.code } }),
      db.auditLog.create({
        data: {
          organizationId: org.id,
          actorId: null,
          actorName: ACTOR_NAME,
          action: "PLAN_CHANGED",
          entityType: "Organization",
          entityId: org.id,
          detail: JSON.stringify({ from: org.plan, to: next.code, usage: used, overLimit: over }),
        },
      }),
    ]);
    console.log(`\nDone: ${org.name} is now on ${next.name}. Audit log entry PLAN_CHANGED written.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
