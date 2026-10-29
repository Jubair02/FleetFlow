import { createHash, randomBytes } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

// ─────────────────────────────────────────────────────────────
// Proof-of-delivery file storage. Files never live in the database and are
// served only through the authenticated /api/pod/[id] route.
//
// - Cloudinary (when CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET are set):
//   uploaded as `type=private` assets, readable only through short-lived
//   signed download URLs. Required on Vercel, whose filesystem is ephemeral.
// - Local disk (storage/pod) otherwise — development and single-server use.
//
// The stored fileKey says where a file lives ("cloudinary:<public_id>.<ext>"
// or a bare local filename), so older local files keep working after a
// switch to Cloudinary (see scripts/migrate-pod-to-cloudinary.mjs).
// ─────────────────────────────────────────────────────────────

const STORAGE_ROOT = path.join(process.cwd(), "storage", "pod");
const CLOUD_PREFIX = "cloudinary:";
const CLOUD_FOLDER = "fleetflow/pod";
/** Max proof image size. Kept under Vercel's ~4.5 MB request limit; the driver app downsizes photos first. */
export const MAX_POD_FILE_BYTES = 4 * 1024 * 1024;

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Detect true image type from magic bytes — never trust the client mime. */
export function detectImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // WebP: RIFF....WEBP
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export interface StoredFile {
  fileKey: string;
  fileName: string;
  mimeType: string;
  size: number;
}

/** Thrown for problems with the uploaded file itself (safe to show the user). */
export class PodFileError extends Error {}

export async function savePodFile(buffer: Buffer, originalName: string): Promise<StoredFile> {
  const mimeType = detectImageMime(buffer);
  if (!mimeType || !ALLOWED_MIME.has(mimeType)) {
    throw new PodFileError("Only PNG, JPEG or WebP images are accepted");
  }
  if (buffer.length > MAX_POD_FILE_BYTES) {
    throw new PodFileError("File too large (max 4 MB)");
  }
  const id = randomBytes(12).toString("hex");
  const ext = EXT_BY_MIME[mimeType];
  const fileName = originalName.replace(/[^\w.\- ]/g, "_").slice(0, 80) || "proof";

  const cloud = cloudinaryConfig();
  if (cloud) {
    await cloudinaryUpload(cloud, buffer, mimeType, `${CLOUD_FOLDER}/${id}`);
    return { fileKey: `${CLOUD_PREFIX}${CLOUD_FOLDER}/${id}.${ext}`, fileName, mimeType, size: buffer.length };
  }
  if (process.env.VERCEL) {
    // Vercel's filesystem is read-only/ephemeral — a local write would be lost.
    throw new Error("Proof-of-delivery storage is not configured (set the CLOUDINARY_* variables)");
  }
  await mkdir(STORAGE_ROOT, { recursive: true });
  const fileKey = `${id}.${ext}`;
  await writeFile(path.join(STORAGE_ROOT, fileKey), buffer);
  return { fileKey, fileName, mimeType, size: buffer.length };
}

export async function readPodFile(fileKey: string): Promise<Buffer> {
  if (fileKey.startsWith(CLOUD_PREFIX)) {
    const { publicId, format } = parseCloudKey(fileKey);
    const res = await fetch(cloudinaryDownloadUrl(requireCloudinary(), publicId, format), {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Cloudinary download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(podPath(fileKey));
}

/** Remove a stored file (e.g. when the DB write that referenced it rolled back). Never throws. */
export async function deletePodFile(fileKey: string): Promise<void> {
  if (fileKey.startsWith(CLOUD_PREFIX)) {
    const cloud = cloudinaryConfig();
    if (!cloud) return;
    await cloudinaryDestroy(cloud, parseCloudKey(fileKey).publicId).catch((e: unknown) =>
      console.error("[storage] could not delete Cloudinary file:", fileKey, e)
    );
    return;
  }
  await unlink(podPath(fileKey)).catch(() => {});
}

// ── local disk ───────────────────────────────────────────────

function podPath(fileKey: string): string {
  // Prevent path traversal: fileKey must be a bare filename
  if (!/^[\w.\-]+$/.test(fileKey)) throw new Error("Invalid file key");
  return path.join(STORAGE_ROOT, fileKey);
}

// ── Cloudinary (REST API, no SDK) ────────────────────────────

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export function cloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

function requireCloudinary(): CloudinaryConfig {
  const cloud = cloudinaryConfig();
  if (!cloud) throw new Error("Cloudinary is not configured");
  return cloud;
}

function parseCloudKey(fileKey: string): { publicId: string; format: string } {
  const m = /^cloudinary:([\w/\-]+)\.(png|jpg|webp)$/.exec(fileKey);
  if (!m) throw new Error("Invalid file key");
  return { publicId: m[1], format: m[2] };
}

/** Cloudinary request signature: SHA-1 of the sorted params plus the API secret. */
export function cloudinarySignature(params: Record<string, string | number>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(toSign + apiSecret).digest("hex");
}

const API = "https://api.cloudinary.com/v1_1";

async function cloudinaryPost(cloud: CloudinaryConfig, action: string, params: Record<string, string | number>, file?: Blob) {
  const signed = { ...params, timestamp: Math.floor(Date.now() / 1000) };
  const form = new FormData();
  for (const [k, v] of Object.entries(signed)) form.set(k, String(v));
  form.set("api_key", cloud.apiKey);
  form.set("signature", cloudinarySignature(signed, cloud.apiSecret));
  if (file) form.set("file", file);
  const res = await fetch(`${API}/${cloud.cloudName}/image/${action}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string }; result?: string };
  // The API secret is never part of a response; the message is safe to log.
  if (!res.ok) throw new Error(`Cloudinary ${action} failed (${res.status}): ${body.error?.message ?? "unknown error"}`);
  return body;
}

async function cloudinaryUpload(cloud: CloudinaryConfig, buffer: Buffer, mimeType: string, publicId: string) {
  await cloudinaryPost(
    cloud,
    "upload",
    { public_id: publicId, type: "private", overwrite: "false" },
    new Blob([new Uint8Array(buffer)], { type: mimeType })
  );
}

async function cloudinaryDestroy(cloud: CloudinaryConfig, publicId: string) {
  const body = await cloudinaryPost(cloud, "destroy", { public_id: publicId, type: "private", invalidate: "true" });
  if (body.result !== "ok" && body.result !== "not found") throw new Error(`Cloudinary destroy: ${body.result}`);
}

/** Signed download URL for a private asset, valid for five minutes. */
export function cloudinaryDownloadUrl(cloud: CloudinaryConfig, publicId: string, format: string, now = Date.now()): string {
  const timestamp = Math.floor(now / 1000);
  const params = { public_id: publicId, format, type: "private", timestamp, expires_at: timestamp + 300 };
  const qs = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    api_key: cloud.apiKey,
    signature: cloudinarySignature(params, cloud.apiSecret),
  });
  return `${API}/${cloud.cloudName}/image/download?${qs}`;
}
