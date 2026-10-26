import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Fly container (node server.js).
  // On Vercel, the platform's own Next.js builder handles output routing, and
  // "standalone" breaks page serving (root 404s), so only enable it off-Vercel.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  // The _vite_legacy folder is the archived previous frontend; keep it out of
  // the Next.js build.
  outputFileTracingExcludes: {
    "*": ["./_vite_legacy/**"],
  },
};

export default nextConfig;
