import { NextResponse } from "next/server";
import { wrap } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const address = String(body?.address || "").trim();
  const amount = Number(body?.amount) || 300_000_000;
  if (!address) return NextResponse.json({ error: "missing address" }, { status: 400 });
  try {
    return NextResponse.json(await wrap(address, amount));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
