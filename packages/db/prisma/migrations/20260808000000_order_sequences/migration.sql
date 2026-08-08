-- CreateTable
CREATE TABLE `order_sequences` (
    `year` INTEGER NOT NULL,
    `lastValue` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed the sequence from the orders that already exist, so numbering continues rather than
-- restarting at 1 and colliding with every order placed before this migration.
INSERT INTO `order_sequences` (`year`, `lastValue`, `updatedAt`)
SELECT
    CAST(SUBSTRING(`orderNo`, 4, 4) AS UNSIGNED) AS `year`,
    MAX(CAST(SUBSTRING(`orderNo`, 9) AS UNSIGNED)) AS `lastValue`,
    NOW(3)
FROM `orders`
WHERE `orderNo` REGEXP '^TS-[0-9]{4}-[0-9]+$'
GROUP BY CAST(SUBSTRING(`orderNo`, 4, 4) AS UNSIGNED);
