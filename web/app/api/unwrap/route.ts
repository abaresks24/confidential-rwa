import { NextResponse } from "next/server";
import { unwrap } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const amount = Number(body?.amount) || undefined;
  try {
    return NextResponse.json(await unwrap(amount));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
