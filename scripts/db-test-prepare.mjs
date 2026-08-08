import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Applies migrations to the *test* database.
 *
 * This used to be a package.json script with the connection string written out inline —
 * `mysql://tapat:password@localhost:3306/tapatshop_test`. Two copies of the same fact, so when
 * the local MySQL moved to another port `.env` was updated and this was not, and the script
 * failed against a server that was no longer there. It also put a password in a file that is
 * committed, which the rest of the project is careful not to do.
 *
 * Now there is one source: `TEST_DATABASE_URL` in `.env`.
 *
 * `.env` is loaded by `dotenv-cli` in the npm script rather than by importing `dotenv` here —
 * that package is a dependency of `apps/web`, not of the root, so a root-level script cannot
 * import it.
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("TEST_DATABASE_URL is not set in .env — nothing to prepare.");
  process.exit(1);
}

/**
 * Refuse to run against the development database.
 *
 * `migrate deploy` is not destructive today, but this script exists to point a migration tool
 * at whatever a variable says, and a typo that aims it at development is the kind of mistake
 * worth making impossible rather than unlikely.
 */
if (!/_test(\?|$)/.test(url)) {
  console.error(`TEST_DATABASE_URL does not name a _test database. Refusing. (${maskUrl(url)})`);
  process.exit(1);
}

function maskUrl(value) {
  return value.replace(/(\/\/[^:]+:)[^@]*@/, "$1***@");
}

console.warn(`Preparing ${maskUrl(url)}`);

const result = spawnSync(
  "pnpm",
  ["--filter", "@tapatshop/db", "exec", "prisma", "migrate", "deploy"],
  { cwd: root, stdio: "inherit", shell: true, env: { ...process.env, DATABASE_URL: url } }
);

process.exit(result.status ?? 1);
