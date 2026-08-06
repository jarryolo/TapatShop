import path from "node:path";

import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// One .env for the whole monorepo, at the repo root.
//
// Next only reads .env files from its own project directory, and Prisma only reads them from
// the schema directory or cwd. Left alone that means two copies of the same secrets drifting
// apart. Loading the root file here runs before the build and before the server starts, so
// both server code and inlined NEXT_PUBLIC_* values see it.
loadEnv({ path: path.join(__dirname, "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Pin the monorepo root. Without this Next walks up looking for a lockfile and can land
  // somewhere outside the repo, which silently breaks standalone output file tracing.
  outputFileTracingRoot: path.join(__dirname, "../.."),

  // Fail the production build on a type or lint error. The default for `eslint` is to run
  // during build, but we run it ourselves in CI — keep the build about types and output.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },

  images: {
    // Product images come from S3-compatible storage, never the repo. See docs/02.
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "9000",
        pathname: "/tapatshop-media/**",
      },
    ],
  },
};

export default nextConfig;
