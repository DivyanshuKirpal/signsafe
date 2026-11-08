import type { NextConfig } from "next";

/**
 * Sent with every response (docs/SECURITY_REVIEW.md, L6): no other site may
 * frame SignSafe (CSP frame-ancestors, with X-Frame-Options for older
 * browsers), browsers must not guess content types, and other sites only
 * learn the origin, not the full URL, when someone follows a link away.
 */
export const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // No "X-Powered-By: Next.js" header.
  poweredByHeader: false,
  // The functions read these at runtime; listed explicitly so a deployment always ships them.
  outputFileTracingIncludes: {
    "/api/scenarios": ["./data/demo.devnet.json"],
    "/api/examples": ["./data/fixtures/*.json"],
  },
  serverExternalPackages: ["ws"],
  turbopack: {
    resolveAlias: {
      fs: { browser: "./empty-module.js" },
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    }
    return config;
  },
};

export default nextConfig;
