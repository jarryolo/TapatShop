-- CreateTable
CREATE TABLE `ph_regions` (
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `regionKey` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `ph_regions_regionKey_key`(`regionKey`),
    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ph_provinces` (
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `regionCode` VARCHAR(191) NOT NULL,

    INDEX `ph_provinces_regionCode_idx`(`regionCode`),
    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ph_cities` (
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `provinceCode` VARCHAR(191) NULL,
    `regionCode` VARCHAR(191) NOT NULL,

    INDEX `ph_cities_provinceCode_idx`(`provinceCode`),
    INDEX `ph_cities_regionCode_idx`(`regionCode`),
    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ph_barangays` (
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `cityCode` VARCHAR(191) NOT NULL,

    INDEX `ph_barangays_cityCode_idx`(`cityCode`),
    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ph_provinces` ADD CONSTRAINT `ph_provinces_regionCode_fkey` FOREIGN KEY (`regionCode`) REFERENCES `ph_regions`(`code`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ph_cities` ADD CONSTRAINT `ph_cities_provinceCode_fkey` FOREIGN KEY (`provinceCode`) REFERENCES `ph_provinces`(`code`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ph_cities` ADD CONSTRAINT `ph_cities_regionCode_fkey` FOREIGN KEY (`regionCode`) REFERENCES `ph_regions`(`code`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ph_barangays` ADD CONSTRAINT `ph_barangays_cityCode_fkey` FOREIGN KEY (`cityCode`) REFERENCES `ph_cities`(`code`) ON DELETE CASCADE ON UPDATE CASCADE;

