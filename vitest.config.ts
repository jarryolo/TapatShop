import { fileURLToPath } from "node:url";

import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Load the repo-root .env so integration tests can find TEST_DATABASE_URL. The empty prefix
// means every variable is loaded, not just VITE_-prefixed ones.
const env = loadEnv("", process.cwd(), "");

export default defineConfig({
  resolve: {
    alias: {
      "@tapatshop/shared": fileURLToPath(new URL("./packages/shared/src", import.meta.url)),
      "@tapatshop/db": fileURLToPath(new URL("./packages/db/src", import.meta.url)),
      "@": fileURLToPath(new URL("./apps/web", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    env,
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    // Argon2 is deliberately slow, and the integration suite talks to MySQL.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
