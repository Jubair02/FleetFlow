#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Change an organization's subscription plan (manual billing).
//
//   node scripts/set-plan.mjs --org <id|exact name> --plan <code>
//        [--cycle monthly|annual] [--price <bdt>] [--dry-run]
//
// Plans are read from the database (Plan table, managed in /platform → Plans).
// Same rules as the platform console's set-plan action:
//   - only ACTIVE plans can be newly assigned (an org may stay on its current
//     inactive plan while its cycle/price changes);
//   - price snapshot = --price if given, else the plan's list price for the
//     cycle; a paid plan without a price for that cycle needs --price; a plan
//     that is free on both cycles snapshots "free" (null);
//   - a no-op (same plan, cycle and price) writes nothing.
// Prints usage against the new plan's limits and warns when usage already
// exceeds them (existing data is NEVER deleted or disabled — only new
// additions get blocked). Then sets Organization.plan / billingCycle /
// subscriptionPriceBdt / planAssignedAt and writes one AuditLog row
// (PLAN_CHANGED). No other writes. --dry-run prints everything, writes nothing.
//
// See docs/BILLING.md for the manual billing process.
// ─────────────────────────────────────────────────────────────

import { existsSync } from "node:fs";
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
const MAX_PRICE_BDT = 10_000_000; // same bound as src/lib/platform-service.ts

function usage() {
  console.log(`Usage: node scripts/set-plan.mjs --org <id|exact name> --plan <code> [--cycle monthly|annual] [--price <bdt>] [--dry-run]

  --org      Organization id, or its exact name
  --plan     Plan code (see /platform → Plans)
  --cycle    Billing cycle: monthly (default) or annual
  --price    Agreed price per cycle in whole BDT (default: the plan's list price for the cycle)
  --dry-run  Show the change and usage check without writing anything`);
}

function parseArgs(argv) {
  const out = { org: "", plan: "", cycle: "MONTHLY", price: undefined, dryRun: false, help: false };
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else {
      const m = /^--(org|plan|cycle|price)(?:=(.*))?$/.exec(a);
      if (!m) throw new Error(`Unknown argument: ${a}`);
      values[m[1]] = m[2] !== undefined ? m[2] : (argv[++i] ?? "");
    }
  }
  if (values.org !== undefined) out.org = values.org.trim();
  if (values.plan !== undefined) out.plan = values.plan.trim().toLowerCase();
  if (values.cycle !== undefined) {
    const c = values.cycle.trim().toUpperCase();
    if (c !== "MONTHLY" && c !== "ANNUAL") throw new Error(`--cycle must be "monthly" or "annual" (got "${values.cycle}")`);
    out.cycle = c;
  }
  if (values.price !== undefined) {
    const t = values.price.trim();
    if (!/^\d+$/.test(t) || Number(t) > MAX_PRICE_BDT) {
      throw new Error(`--price must be a whole number of taka between 0 and ${MAX_PRICE_BDT} (got "${values.price}")`);
    }
    out.price = Number(t);
  }
  return out;
}

const limitsOf = (p) => ({ drivers: p.maxDrivers, vehicles: p.maxVehicles, admins: p.maxAdmins, monthlyDeliveries: p.maxMonthlyDeliveries });
const listPrice = (p, cycle) => (cycle === "ANNUAL" ? p.annualPriceBdt : p.monthlyPriceBdt);

/** Same rule as resolveSnapshotPrice() in src/lib/platform-service.ts. */
function snapshotPrice(plan, cycle, price) {
  if (price !== undefined) return price;
  const list = listPrice(plan, cycle);
  if (list !== null || (plan.monthlyPriceBdt === null && plan.annualPriceBdt === null)) return list;
  throw new Error(`The ${plan.name} plan has no ${cycle.toLowerCase()} price — use the other --cycle or pass --price`);
}

const fmtPrice = (n, cycle) => (n === null ? "free" : `৳${n}/${cycle === "ANNUAL" ? "year" : "month"}`);
const fmtLimit = (n) => (n === null ? "unlimited" : String(n));

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.org || !args.plan) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  if (!process.env.DATABASE_URL && existsSync(resolve(ROOT, ".env"))) process.loadEnvFile?.(resolve(ROOT, ".env"));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (and no .env found)");

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ log: ["error"] });
  try {
    const plans = await db.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
    const next = plans.find((p) => p.code === args.plan);
    if (!next) throw new Error(`Unknown plan "${args.plan}". Choose one of: ${plans.map((p) => p.code).join(", ")}`);

    const org = await findOrg(db, args.org);
    const current = plans.find((p) => p.code === org.plan);
    if (!current) throw new Error(`Organization plan "${org.plan}" is not in the Plan table — has the plan migration run?`);
    if (next.code !== org.plan && !next.active) {
      throw new Error(`The ${next.name} plan is inactive and can't be newly assigned (activate it in /platform → Plans first)`);
    }
    const snapshot = snapshotPrice(next, args.cycle, args.price);
    const list = listPrice(next, args.cycle);
    const used = await getUsage(db, org.id, org.timezone);

    console.log(`Organization : ${org.name} (${org.id})`);
    console.log(`Current plan : ${current.name} [${org.plan}] — ${org.billingCycle.toLowerCase()}, ${fmtPrice(org.subscriptionPriceBdt, org.billingCycle)}`);
    console.log(
      `New plan     : ${next.name} [${next.code}] — ${args.cycle.toLowerCase()}, ${fmtPrice(snapshot, args.cycle)}` +
        (snapshot !== list ? ` (negotiated; list ${fmtPrice(list, args.cycle)})` : "")
    );
    console.log("");
    console.log("Usage vs limits (current → new):");
    const currentLimits = limitsOf(current);
    const nextLimits = limitsOf(next);
    const over = [];
    for (const r of RESOURCES) {
      const lim = nextLimits[r];
      const exceeds = lim !== null && used[r] > lim;
      if (exceeds) over.push(r);
      console.log(
        `  ${RESOURCE_LABELS[r].padEnd(28)} ${String(used[r]).padStart(6)}   ${fmtLimit(currentLimits[r]).padStart(9)} → ${fmtLimit(lim).padStart(9)}${exceeds ? "   ⚠ OVER" : ""}`
      );
    }
    if (over.length) {
      console.log("");
      console.warn(`WARNING: usage already exceeds the ${next.name} plan for: ${over.map((r) => RESOURCE_LABELS[r]).join(", ")}.`);
      console.warn("Existing data is kept untouched; only NEW additions of those resources will be refused until usage drops.");
    }

    if (org.plan === next.code && org.billingCycle === args.cycle && org.subscriptionPriceBdt === snapshot) {
      console.log("\nNo change: the organization is already on this plan, cycle and price. Nothing written.");
      return;
    }
    if (args.dryRun) {
      console.log("\n--dry-run: nothing written.");
      return;
    }

    await db.$transaction([
      db.organization.update({
        where: { id: org.id },
        data: { plan: next.code, billingCycle: args.cycle, subscriptionPriceBdt: snapshot, planAssignedAt: new Date() },
      }),
      db.auditLog.create({
        data: {
          organizationId: org.id,
          actorId: null,
          actorName: ACTOR_NAME,
          action: "PLAN_CHANGED",
          entityType: "Organization",
          entityId: org.id,
          detail: JSON.stringify({
            from: { plan: org.plan, billingCycle: org.billingCycle, priceBdt: org.subscriptionPriceBdt },
            to: { plan: next.code, billingCycle: args.cycle, priceBdt: snapshot },
            listPriceBdt: list,
            usage: used,
            overLimit: over,
          }),
        },
      }),
    ]);
    console.log(`\nDone: ${org.name} is now on ${next.name} (${args.cycle.toLowerCase()}, ${fmtPrice(snapshot, args.cycle)}). Audit log entry PLAN_CHANGED written.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
