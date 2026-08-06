-- One-time local database setup, for a MySQL server you already run yourself.
--
-- Run as root:
--   mysql -u root -p < scripts/setup-local-mysql.sql
--
-- If you use the Docker Compose stack instead (pnpm docker:up), you do not need this —
-- docker/mysql/init does the same thing on first boot.
--
-- Creates the two databases Prisma needs and an application user scoped to them. The
-- credentials match the defaults in .env.example; change both together if you change one.
--
-- Note the collation: utf8mb4_0900_ai_ci, per docs/02-architecture.md. It is set per
-- database so it does not matter what the server default happens to be.

CREATE DATABASE IF NOT EXISTS tapatshop
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- Prisma Migrate diffs every migration against a throwaway copy of the schema. Without a
-- shadow database it tries to create one itself, which needs CREATE DATABASE — a privilege
-- the app user should not have.
CREATE DATABASE IF NOT EXISTS tapatshop_shadow
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS 'tapat'@'localhost' IDENTIFIED BY 'password';
CREATE USER IF NOT EXISTS 'tapat'@'%' IDENTIFIED BY 'password';

-- Local development only. In production the app user gets no DROP and migrations run as a
-- separate account; see docs/02-architecture.md.
GRANT ALL PRIVILEGES ON tapatshop.* TO 'tapat'@'localhost';
GRANT ALL PRIVILEGES ON tapatshop.* TO 'tapat'@'%';
GRANT ALL PRIVILEGES ON tapatshop_shadow.* TO 'tapat'@'localhost';
GRANT ALL PRIVILEGES ON tapatshop_shadow.* TO 'tapat'@'%';

FLUSH PRIVILEGES;

SELECT 'tapatshop and tapatshop_shadow are ready' AS status;
