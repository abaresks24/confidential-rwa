import { NextResponse } from "next/server";

// Fly health check target. Must be cheap and never touch the chain.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, service: "confidential-rwa-api" }, { status: 200 });
}
