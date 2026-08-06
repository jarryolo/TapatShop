-- CreateIndex
CREATE INDEX `coupon_redemptions_couponId_userId_idx` ON `coupon_redemptions`(`couponId`, `userId`);

-- CreateIndex
CREATE UNIQUE INDEX `coupon_redemptions_couponId_orderId_key` ON `coupon_redemptions`(`couponId`, `orderId`);
