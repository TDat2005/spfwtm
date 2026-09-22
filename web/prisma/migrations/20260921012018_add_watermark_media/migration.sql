-- CreateTable
CREATE TABLE `media_assets` (
    `id` VARCHAR(36) NOT NULL,
    `shopId` VARCHAR(30) NOT NULL,
    `kind` ENUM('SOURCE', 'PROCESSED') NOT NULL,
    `storageKey` VARCHAR(500) NOT NULL,
    `sourceUrl` TEXT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `byteSize` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `media_assets_storageKey_key`(`storageKey`),
    INDEX `media_assets_shopId_createdAt_idx`(`shopId`, `createdAt`),
    INDEX `media_assets_shopId_contentHash_idx`(`shopId`, `contentHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `watermark_jobs` (
    `id` VARCHAR(36) NOT NULL,
    `shopId` VARCHAR(30) NOT NULL,
    `catalogProductId` VARCHAR(30) NOT NULL,
    `sourceImageUrl` TEXT NOT NULL,
    `text` VARCHAR(100) NOT NULL,
    `position` ENUM('TOP_LEFT', 'TOP_RIGHT', 'CENTER', 'BOTTOM_LEFT', 'BOTTOM_RIGHT') NOT NULL,
    `opacity` DOUBLE NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `resultMediaId` VARCHAR(36) NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `watermark_jobs_shopId_createdAt_idx`(`shopId`, `createdAt`),
    INDEX `watermark_jobs_shopId_status_idx`(`shopId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shops`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `watermark_jobs` ADD CONSTRAINT `watermark_jobs_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shops`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `watermark_jobs` ADD CONSTRAINT `watermark_jobs_catalogProductId_fkey` FOREIGN KEY (`catalogProductId`) REFERENCES `catalog_products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `watermark_jobs` ADD CONSTRAINT `watermark_jobs_resultMediaId_fkey` FOREIGN KEY (`resultMediaId`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
