import { NextResponse } from "next/server";
import { submitSignedXdr } from "@/lib/tx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const signedXdr = String(body?.signedXdr || "");
  if (!signedXdr) return NextResponse.json({ error: "missing signedXdr" }, { status: 400 });
  try {
    return NextResponse.json(await submitSignedXdr(signedXdr));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
