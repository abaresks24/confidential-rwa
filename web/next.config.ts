import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The _vite_legacy folder is the archived previous frontend; keep it out of
  // the Next.js build.
  outputFileTracingExcludes: {
    "*": ["./_vite_legacy/**"],
  },
};

export default nextConfig;
