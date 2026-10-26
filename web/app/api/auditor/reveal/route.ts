import { NextResponse } from "next/server";
import { auditorReveal } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const key = String(body?.key || "");
  try {
    return NextResponse.json(await auditorReveal(key));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
