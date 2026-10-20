import { NextResponse } from "next/server";
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

export function fail(e: unknown) {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[api] unexpected error:", e);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "Authentication required");
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
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
}
