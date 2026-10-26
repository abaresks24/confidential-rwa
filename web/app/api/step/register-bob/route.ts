import { NextResponse } from "next/server";
import { registerBob } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(await registerBob());
}
