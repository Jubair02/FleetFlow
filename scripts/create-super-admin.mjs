#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Bootstrap a FleetFlow platform (super) admin. This script is the ONLY way
// to create one — there is no registration endpoint. Run it on a machine
// that already holds DATABASE_URL.
//
//   node scripts/create-super-admin.mjs --email ops@fleetflow.app --name "Ops Admin"
//   node scripts/create-super-admin.mjs --email ops@fleetflow.app --reset-password
//
// Password: taken from SUPER_ADMIN_PASSWORD (≥ 12 chars) if set; otherwise a
// random temporary password is generated and printed ONCE to this terminal,
// and the admin must change it at first sign-in. Nothing secret is logged
// to the database.
// ─────────────────────────────────────────────────────────────
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomInt, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scrypt = promisify(scryptCb);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reset-password") out.reset = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const USAGE = `Usage:
  node scripts/create-super-admin.mjs --email <email> --name "<name>"
  node scripts/create-super-admin.mjs --email <email> --reset-password
Set SUPER_ADMIN_PASSWORD (12+ chars) to choose the password; otherwise a temporary one is generated.`;

// Same format as src/lib/auth.ts hashPassword: "<salt hex>:<scrypt 64-byte hex>"
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await scrypt(password, salt, 64)).toString("hex")}`;
}

function tempPassword() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 16; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.email) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }
  const email = String(args.email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid --email");

  const chosen = process.env.SUPER_ADMIN_PASSWORD;
  if (chosen !== undefined && chosen.length < 12) throw new Error("SUPER_ADMIN_PASSWORD must be at least 12 characters");
  const password = chosen ?? tempPassword();
  const mustChangePassword = chosen === undefined;

  if (!process.env.DATABASE_URL && existsSync(resolve(ROOT, ".env"))) process.loadEnvFile?.(resolve(ROOT, ".env"));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (and no .env found)");

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ log: ["error"] });
  try {
    const existing = await db.platformAdmin.findUnique({ where: { email } });
    const passwordHash = await hashPassword(password);

    if (args.reset) {
      if (!existing) throw new Error(`No platform admin with email ${email}`);
      await db.$transaction([
        db.platformAdmin.update({ where: { id: existing.id }, data: { passwordHash, mustChangePassword, active: true } }),
        db.platformSession.deleteMany({ where: { adminId: existing.id } }),
        db.platformAuditLog.create({
          data: { actorName: "CLI bootstrap", action: "PLATFORM_ADMIN_PASSWORD_RESET", targetType: "PlatformAdmin", targetId: existing.id, detail: JSON.stringify({ email }) },
        }),
      ]);
      console.log(`Password reset for platform admin ${email}. All their sessions were signed out.`);
    } else {
      if (existing) throw new Error(`A platform admin with email ${email} already exists (use --reset-password)`);
      const name = String(args.name ?? "").trim();
      if (name.length < 2) throw new Error('Provide --name "<full name>"');
      const admin = await db.platformAdmin.create({ data: { email, name, passwordHash, mustChangePassword } });
      await db.platformAuditLog.create({
        data: { actorName: "CLI bootstrap", action: "PLATFORM_ADMIN_CREATED", targetType: "PlatformAdmin", targetId: admin.id, detail: JSON.stringify({ email, name }) },
      });
      console.log(`Created platform admin ${name} <${email}>.`);
    }

    if (mustChangePassword) {
      console.log(`\nTemporary password (shown once — store it safely, it must be changed at first sign-in):\n\n  ${password}\n`);
    }
    console.log("Sign in at <APP_URL>/platform");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
