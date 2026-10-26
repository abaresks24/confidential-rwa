import { NextResponse } from "next/server";
import { buildRegisterXdr } from "@/lib/tx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const address = String(body?.address || "").trim();
  if (!address || !address.startsWith("G") || address.length !== 56) {
    return NextResponse.json({ error: "missing or invalid address (G...)" }, { status: 400 });
  }
  try {
    return NextResponse.json(await buildRegisterXdr(address));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
