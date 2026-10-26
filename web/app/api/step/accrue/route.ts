import { NextResponse } from "next/server";
import { accrue } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await accrue(Number(body?.bps) || 500));
}
