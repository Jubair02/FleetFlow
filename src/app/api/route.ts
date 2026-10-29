import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cloudinaryConfig } from "@/lib/storage";

/**
 * GET /api — health check for uptime monitors. 200 when the database answers,
 * 503 otherwise. Reports only coarse status — never configuration values.
 */
export async function GET() {
  const started = Date.now();
  let database: "ok" | "down" = "ok";
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (e) {
    database = "down";
    console.error("[health] database check failed:", e instanceof Error ? e.message : e);
  }
  const healthy = database === "ok";
  return NextResponse.json(
    {
      service: "FleetFlow API",
      status: healthy ? "ok" : "degraded",
      database,
      dbLatencyMs: Date.now() - started,
      storage: cloudinaryConfig() ? "cloudinary" : "local",
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
