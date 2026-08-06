-- AlterTable
ALTER TABLE `password_reset_tokens` ADD COLUMN `purpose` ENUM('email_verification', 'password_reset') NOT NULL DEFAULT 'password_reset';

-- CreateIndex
CREATE INDEX `password_reset_tokens_userId_purpose_idx` ON `password_reset_tokens`(`userId`, `purpose`);
