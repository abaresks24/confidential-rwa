import { NextResponse } from "next/server";
import { state } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await state());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
