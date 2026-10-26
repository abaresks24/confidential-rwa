// =============================================================================
// Client-side API base URL resolver.
//
// All browser -> backend calls go through `api(path)`. The backend base URL is
// env-driven so the frontend can either:
//   - be served by the SAME Next.js server that also runs the /api/* handlers
//     (default: same-origin, NEXT_PUBLIC_BACKEND_URL unset) — this is how the
//     Fly image runs it; or
//   - be split onto a static host (e.g. Vercel) that talks to the Fly backend,
//     by setting NEXT_PUBLIC_BACKEND_URL=https://confidential-rwa-api.fly.dev.
//
// NEXT_PUBLIC_* is inlined at build time by Next. Empty / unset => same-origin
// relative fetch, which is the correct local-dev and single-server behaviour.
// =============================================================================
const RAW = (process.env.NEXT_PUBLIC_BACKEND_URL || "").trim();
const BASE = RAW.replace(/\/+$/, ""); // strip trailing slashes

export function api(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return BASE ? `${BASE}${p}` : p;
}
