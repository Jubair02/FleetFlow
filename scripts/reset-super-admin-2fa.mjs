#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Recovery for a super admin who lost their authenticator app AND their
// backup codes. Clears their two-factor setup and signs them out
// everywhere; at their next sign-in (password first) they must enrol a
// new authenticator app. Run it on a machine that already holds
// DATABASE_URL, after verifying the person's identity out of band.
//
//   node scripts/reset-super-admin-2fa.mjs ops@fleetflow.app
//   node scripts/reset-super-admin-2fa.mjs --email ops@fleetflow.app
//
// Two-factor can't be switched off: this only forces a fresh enrolment.
// Nothing secret is printed or logged.
// ─────────────────────────────────────────────────────────────
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `Usage:
  node scripts/reset-super-admin-2fa.mjs <email>
Clears the platform admin's authenticator app and backup codes and signs them out;
they set up two-factor again at their next sign-in.`;

function parseEmail(argv) {
  const i = argv.indexOf("--email");
  if (i !== -1) return argv[i + 1];
  return argv.find((a) => !a.startsWith("-"));
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const raw = parseEmail(argv);
  if (!raw) {
    console.log(USAGE);
    process.exit(1);
  }
  const email = String(raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email");

  if (!process.env.DATABASE_URL && existsSync(resolve(ROOT, ".env"))) process.loadEnvFile?.(resolve(ROOT, ".env"));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (and no .env found)");

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ log: ["error"] });
  try {
    const admin = await db.platformAdmin.findUnique({ where: { email } });
    if (!admin) throw new Error(`No platform admin with email ${email}`);
    const [, sessions] = await db.$transaction([
      db.platformAdmin.update({
        where: { id: admin.id },
        data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpBackupCodes: [] },
      }),
      db.platformSession.deleteMany({ where: { adminId: admin.id } }),
      db.platformAuditLog.create({
        data: {
          actorName: "CLI recovery",
          action: "PLATFORM_MFA_RESET",
          targetType: "PlatformAdmin",
          targetId: admin.id,
          detail: JSON.stringify({ email, wasEnrolled: !!admin.totpEnabledAt }),
        },
      }),
    ]);
    console.log(`Two-factor sign-in reset for ${email}; ${sessions.count} session(s) signed out.`);
    console.log("They will set up a new authenticator app at their next sign-in (password first).");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
