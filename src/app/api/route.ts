import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ service: "FleetFlow API", status: "ok", time: new Date().toISOString() });
}
