-- Runs once, on first boot of an empty mysql volume.
--
-- Prisma Migrate needs a second, throwaway database to diff migrations against. Without it,
-- `prisma migrate dev` tries to create one itself and fails unless the app user can CREATE
-- DATABASE — which in production it deliberately cannot.
--
-- Local only. In production the app user has no DROP privilege and migrations run as a
-- separate user; see docs/02-architecture.md.

CREATE DATABASE IF NOT EXISTS tapatshop_shadow
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

GRANT ALL PRIVILEGES ON tapatshop.* TO 'tapat'@'%';
GRANT ALL PRIVILEGES ON tapatshop_shadow.* TO 'tapat'@'%';
FLUSH PRIVILEGES;
