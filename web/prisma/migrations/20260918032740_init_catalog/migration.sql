-- CreateTable
CREATE TABLE `shops` (
    `id` VARCHAR(30) NOT NULL,
    `domain` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `shops_domain_key`(`domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `catalog_products` (
    `id` VARCHAR(30) NOT NULL,
    `shopId` VARCHAR(30) NOT NULL,
    `shopifyProductId` VARCHAR(255) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `status` ENUM('ACTIVE', 'DRAFT', 'ARCHIVED') NOT NULL,
    `imageUrl` TEXT NULL,
    `imageAltText` TEXT NULL,
    `sourceVersion` INTEGER NOT NULL DEFAULT 1,
    `sourceMediaId` VARCHAR(255) NULL,
    `sourceContentHash` CHAR(64) NULL,
    `needsReview` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `catalog_products_shopId_deletedAt_idx`(`shopId`, `deletedAt`),
    UNIQUE INDEX `catalog_products_shopId_shopifyProductId_key`(`shopId`, `shopifyProductId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `catalog_products` ADD CONSTRAINT `catalog_products_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shops`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
