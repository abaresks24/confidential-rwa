import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// =============================================================================
// CORS for the API surface.
//
// The frontend may be served same-origin (the Fly Next.js server also serves
// the UI) OR split onto another origin (e.g. a Vercel static deploy) that calls
// this backend cross-origin. In the split case the browser needs CORS headers.
//
// ALLOWED_ORIGIN env controls the allowed origin; default '*' (permissive, fine
// for a public testnet demo). Applied to /api/* and /health. OPTIONS preflight
// is answered here with 204.
// =============================================================================
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

function cors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "content-type");
  if (ALLOWED_ORIGIN !== "*") res.headers.set("Vary", "Origin");
  return res;
}

export function middleware(req: NextRequest) {
  if (req.method === "OPTIONS") {
    return cors(new NextResponse(null, { status: 204 }));
  }
  return cors(NextResponse.next());
}

export const config = {
  matcher: ["/api/:path*", "/health"],
};
