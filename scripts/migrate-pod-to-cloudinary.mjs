#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Move proof-of-delivery files from local disk (storage/pod) to Cloudinary.
//
//   node scripts/migrate-pod-to-cloudinary.mjs [--dry-run]
//
// For every ProofOfDelivery whose fileKey is still a local filename:
//   1. upload storage/pod/<fileKey> as a PRIVATE Cloudinary asset;
//   2. point the row at it (fileKey = "cloudinary:fleetflow/pod/<id>.<ext>").
// Local files are NOT deleted — remove storage/pod yourself once you have
// checked the proofs open in the app. Re-running skips rows already moved.
// Rows whose local file is missing are reported and left unchanged.
//
// Needs DATABASE_URL and CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET
// (read from .env if not set). Uses the same signing as src/lib/storage.ts.
// ─────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STORAGE_ROOT = resolve(ROOT, "storage", "pod");
const CLOUD_FOLDER = "fleetflow/pod";
const MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

function sign(params, secret) {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return createHash("sha1").update(toSign + secret).digest("hex");
}

async function upload(cloud, buffer, mime, publicId) {
  const params = { overwrite: "false", public_id: publicId, timestamp: Math.floor(Date.now() / 1000), type: "private" };
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) form.set(k, String(v));
  form.set("api_key", cloud.apiKey);
  form.set("signature", sign(params, cloud.apiSecret));
  form.set("file", new Blob([new Uint8Array(buffer)], { type: mime }));
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud.cloudName}/image/upload`, {
    method: "POST", body: form, signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => ({}));
  // "already exists" (overwrite=false) means an earlier run uploaded it but didn't update the row.
  if (!res.ok && !/already exists/i.test(body?.error?.message ?? "")) {
    throw new Error(`upload failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (existsSync(resolve(ROOT, ".env"))) process.loadEnvFile?.(resolve(ROOT, ".env"));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (and no .env found)");
  const cloud = {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  };
  if (!cloud.cloudName || !cloud.apiKey || !cloud.apiSecret) {
    throw new Error("Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET first");
  }

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ log: ["error"] });
  try {
    const rows = await db.proofOfDelivery.findMany({
      where: { NOT: { fileKey: { startsWith: "cloudinary:" } } },
      select: { id: true, fileKey: true },
      orderBy: { createdAt: "asc" },
    });
    console.log(`${rows.length} proof file(s) still on local disk${dryRun ? " (dry run — nothing will change)" : ""}`);

    let moved = 0, missing = 0, failed = 0;
    for (const row of rows) {
      const m = /^([\w-]+)\.(png|jpg|webp)$/.exec(row.fileKey);
      const file = m ? resolve(STORAGE_ROOT, row.fileKey) : null;
      if (!m || !file || !existsSync(file)) {
        console.warn(`  missing  ${row.id}  ${row.fileKey}`);
        missing++;
        continue;
      }
      const [, id, ext] = m;
      const publicId = `${CLOUD_FOLDER}/${id}`;
      const fileKey = `cloudinary:${publicId}.${ext}`;
      if (dryRun) {
        console.log(`  would move  ${row.id}  ${row.fileKey} → ${fileKey}`);
        continue;
      }
      try {
        await upload(cloud, await readFile(file), MIME[ext], publicId);
        // Only rows still pointing at the local file are updated (safe with concurrent runs).
        await db.proofOfDelivery.updateMany({ where: { id: row.id, fileKey: row.fileKey }, data: { fileKey } });
        console.log(`  moved    ${row.id}  → ${fileKey}`);
        moved++;
      } catch (e) {
        console.error(`  FAILED   ${row.id}  ${e instanceof Error ? e.message : e}`);
        failed++;
      }
    }
    console.log(`Done: ${moved} moved, ${missing} missing locally, ${failed} failed.`);
    if (failed) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
