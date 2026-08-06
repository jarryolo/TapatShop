-- CreateTable
CREATE TABLE `account_recovery_requests` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `claimedName` VARCHAR(191) NOT NULL,
    `claimedEmail` VARCHAR(191) NULL,
    `claimedMemberNo` VARCHAR(191) NULL,
    `claimedOrderNo` VARCHAR(191) NULL,
    `claimedAddress` TEXT NULL,
    `newEmail` VARCHAR(191) NOT NULL,
    `status` ENUM('pending', 'approved', 'confirmed', 'rejected') NOT NULL DEFAULT 'pending',
    `reviewNote` TEXT NULL,
    `tokenHash` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `account_recovery_requests_tokenHash_key`(`tokenHash`),
    INDEX `account_recovery_requests_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `account_recovery_requests_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `account_recovery_requests` ADD CONSTRAINT `account_recovery_requests_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_recovery_requests` ADD CONSTRAINT `account_recovery_requests_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
