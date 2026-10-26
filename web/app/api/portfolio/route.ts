import { NextResponse } from "next/server";
import { portfolio } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = (url.searchParams.get("address") || "").trim();
  if (!address || !address.startsWith("G") || address.length !== 56) {
    return NextResponse.json({ error: "missing or invalid address (G...)" }, { status: 400 });
  }
  try {
    return NextResponse.json(await portfolio(address));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
