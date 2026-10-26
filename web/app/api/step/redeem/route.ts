import { NextResponse } from "next/server";
import { redeem } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(await redeem());
}
