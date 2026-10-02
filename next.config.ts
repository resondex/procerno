import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Local-only SQLite store (prod uses Postgres): keep the native add-on and
  // the local database files out of every deployed function. Vercel's free
  // plan caps total function storage at 10 GB across retained deployments.
  outputFileTracingExcludes: {
    "*": ["node_modules/better-sqlite3/**", "node_modules/bindings/**", "node_modules/file-uri-to-path/**", "data/**"],
  },
};

export default nextConfig;
