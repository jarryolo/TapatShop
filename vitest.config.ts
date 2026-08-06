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

    /**
     * One test file at a time.
     *
     * The integration suites share a single database and each clears the tables it uses in
     * beforeEach. Run in parallel, one file deletes another's fixtures mid-test and both
     * fail in ways that look like application bugs. The alternatives — a database per file,
     * or scoping every wipe to a per-file prefix — cost more than the second this saves on a
     * suite that finishes in about four.
     */
    fileParallelism: false,
  },
});
