-- CreateTable
CREATE TABLE `published_media` (
    `id` VARCHAR(36) NOT NULL,
    `shopId` VARCHAR(30) NOT NULL,
    `watermarkJobId` VARCHAR(36) NOT NULL,
    `shopifyProductId` VARCHAR(255) NOT NULL,
    `shopifyMediaId` VARCHAR(255) NOT NULL,
    `imageUrl` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `published_media_watermarkJobId_key`(`watermarkJobId`),
    INDEX `published_media_shopId_createdAt_idx`(`shopId`, `createdAt`),
    INDEX `published_media_shopId_shopifyProductId_idx`(`shopId`, `shopifyProductId`),
    UNIQUE INDEX `published_media_shopId_shopifyMediaId_key`(`shopId`, `shopifyMediaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `published_media` ADD CONSTRAINT `published_media_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shops`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `published_media` ADD CONSTRAINT `published_media_watermarkJobId_fkey` FOREIGN KEY (`watermarkJobId`) REFERENCES `watermark_jobs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
