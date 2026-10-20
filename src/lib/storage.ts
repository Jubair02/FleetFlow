import { randomBytes } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

// ─────────────────────────────────────────────────────────────
// Proof-of-delivery file storage.
// Files live on disk (object-storage-style), NOT in the database.
// They are served only through an authenticated API route.
// ─────────────────────────────────────────────────────────────

const STORAGE_ROOT = path.join(process.cwd(), "storage", "pod");

export async function ensureStorage(): Promise<void> {
  await mkdir(STORAGE_ROOT, { recursive: true });
}

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

export async function savePodFile(buffer: Buffer, originalName: string): Promise<StoredFile> {
  await ensureStorage();
  const mimeType = detectImageMime(buffer);
  if (!mimeType || !ALLOWED_MIME.has(mimeType)) {
    throw new Error("Only PNG, JPEG or WebP images are accepted");
  }
  if (buffer.length > 8 * 1024 * 1024) {
    throw new Error("File too large (max 8 MB)");
  }
  const id = randomBytes(12).toString("hex");
  const fileKey = `${id}.${EXT_BY_MIME[mimeType]}`;
  await writeFile(path.join(STORAGE_ROOT, fileKey), buffer);
  return { fileKey, fileName: originalName.replace(/[^\w.\- ]/g, "_").slice(0, 80) || "proof", mimeType, size: buffer.length };
}

export async function readPodFile(fileKey: string): Promise<Buffer> {
  // Prevent path traversal: fileKey must be a bare filename
  if (!/^[\w.\-]+$/.test(fileKey)) throw new Error("Invalid file key");
  return readFile(path.join(STORAGE_ROOT, fileKey));
}
