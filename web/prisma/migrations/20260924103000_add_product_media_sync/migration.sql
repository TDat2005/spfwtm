-- AlterTable
ALTER TABLE `background_jobs`
  ADD COLUMN `payloadVersion` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `processorVersion` INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE `webhook_inbox` (
  `id` VARCHAR(36) NOT NULL,
  `webhookId` VARCHAR(255) NOT NULL,
  `eventId` VARCHAR(255) NULL,
  `shopId` VARCHAR(30) NOT NULL,
  `topic` VARCHAR(100) NOT NULL,
  `apiVersion` VARCHAR(20) NOT NULL,
  `triggeredAt` DATETIME(3) NOT NULL,
  `productId` VARCHAR(255) NOT NULL,
  `payload` LONGTEXT NOT NULL,
  `status` ENUM('RECEIVED', 'ENQUEUED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED') NOT NULL DEFAULT 'RECEIVED',
  `processedAt` DATETIME(3) NULL,
  `errorMessage` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `webhook_inbox_webhookId_key`(`webhookId`),
  INDEX `webhook_inbox_shopId_productId_triggeredAt_idx`(`shopId`, `productId`, `triggeredAt`),
  INDEX `webhook_inbox_status_createdAt_idx`(`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `publication_attempts` (
  `id` VARCHAR(36) NOT NULL,
  `shopId` VARCHAR(30) NOT NULL,
  `productId` VARCHAR(255) NOT NULL,
  `watermarkJobId` VARCHAR(36) NOT NULL,
  `shopifyMediaId` VARCHAR(255) NULL,
  `status` ENUM('PUBLISHING', 'PUBLISHED', 'FAILED') NOT NULL DEFAULT 'PUBLISHING',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,

  INDEX `publication_attempts_shopId_productId_status_idx`(`shopId`, `productId`, `status`),
  INDEX `publication_attempts_shopId_shopifyMediaId_idx`(`shopId`, `shopifyMediaId`),
  INDEX `publication_attempts_watermarkJobId_createdAt_idx`(`watermarkJobId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `webhook_inbox`
  ADD CONSTRAINT `webhook_inbox_shopId_fkey`
  FOREIGN KEY (`shopId`) REFERENCES `shops`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `publication_attempts`
  ADD CONSTRAINT `publication_attempts_shopId_fkey`
  FOREIGN KEY (`shopId`) REFERENCES `shops`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `publication_attempts`
  ADD CONSTRAINT `publication_attempts_watermarkJobId_fkey`
  FOREIGN KEY (`watermarkJobId`) REFERENCES `watermark_jobs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
