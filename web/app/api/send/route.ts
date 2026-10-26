import { NextResponse } from "next/server";
import { send_ } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const to = String(body?.to || "").trim();
  const amount = Number(body?.amount) || 0;
  const token = body?.token ? String(body.token) : undefined;
  const from = body?.from ? String(body.from) : undefined;
  if (!to) return NextResponse.json({ error: "missing 'to' address" }, { status: 400 });
  if (amount <= 0) return NextResponse.json({ error: "missing/invalid amount" }, { status: 400 });
  try {
    return NextResponse.json(await send_({ to, amount, token, from }));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
