import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { getSessionUser, type SessionUser } from "@/lib/auth";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data as object, { status });
}

const PRISMA_ERRORS: Record<string, [number, string]> = {
  P2002: [409, "A record with this value already exists"],
  P2003: [409, "This record is still referenced by other data"],
  P2025: [404, "Record not found"],
  P2034: [409, "The record was changed concurrently — please retry"],
};

export function fail(e: unknown) {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = PRISMA_ERRORS[e.code];
    if (mapped) return NextResponse.json({ error: mapped[1] }, { status: mapped[0] });
  }
  if (e instanceof Prisma.PrismaClientValidationError) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  // Handled here, so Next's onRequestError never sees it — report it ourselves.
  Sentry.captureException(e);
  console.error("[api] unexpected error:", e);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/**
 * By default a user who still has an admin-issued temporary password may only
 * reach the endpoint that lets them replace it.
 */
export async function requireUser(opts: { allowPasswordChangePending?: boolean } = {}): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "Authentication required");
  if (user.mustChangePassword && !opts.allowPasswordChangePending) {
    throw new ApiError(403, "Change your temporary password before continuing");
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    throw new ApiError(403, "Admin access required");
  }
  return user;
}

export async function requireDriver(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "DRIVER" || !user.driverProfile) {
    throw new ApiError(403, "Driver access required");
  }
  return user;
}

/** Parse a JSON body, throwing a clean 400 on malformed input. */
export async function readJson<T>(req: Request): Promise<T> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "Expected an application/json body");
  }
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
}

/**
 * Parse an ISO date/datetime query param. Clients send instants computed in
 * the viewer's local timezone (e.g. local midnight as an ISO string).
 */
export function parseDateParam(value: string | null | undefined, name: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, `Invalid ${name} date`);
  return d;
}

/** Viewer's timezone offset in minutes (as returned by Date#getTimezoneOffset). */
export function parseTzOffset(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && Math.abs(n) <= 14 * 60 ? n : 0;
}

/** YYYY-MM-DD of an instant in the viewer's timezone. */
export function localDayKey(d: Date, tzOffset: number): string {
  return new Date(d.getTime() - tzOffset * 60_000).toISOString().slice(0, 10);
}
