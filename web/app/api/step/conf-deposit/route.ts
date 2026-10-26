import { NextResponse } from "next/server";
import { confDeposit } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await confDeposit(Number(body?.amount) || 300_000_000));
}
