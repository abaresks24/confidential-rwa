import { NextResponse } from "next/server";
import { buildDepositXdr } from "@/lib/tx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const address = String(body?.address || "");
  const amount = String(body?.amount || "300000000");
  if (!address) return NextResponse.json({ error: "missing address" }, { status: 400 });
  try {
    const xdr = await buildDepositXdr(address, amount);
    return NextResponse.json({ xdr });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
