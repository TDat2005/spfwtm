-- CreateTable
CREATE TABLE `watermark_batches` (
  `id` VARCHAR(36) NOT NULL,
  `shopId` VARCHAR(30) NOT NULL,
  `totalJobs` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `watermark_batches_shopId_createdAt_idx`(`shopId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `watermark_jobs`
  ADD COLUMN `batchId` VARCHAR(36) NULL;

CREATE INDEX `watermark_jobs_batchId_status_idx`
  ON `watermark_jobs`(`batchId`, `status`);

-- AddForeignKey
ALTER TABLE `watermark_batches`
  ADD CONSTRAINT `watermark_batches_shopId_fkey`
  FOREIGN KEY (`shopId`) REFERENCES `shops`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `watermark_jobs`
  ADD CONSTRAINT `watermark_jobs_batchId_fkey`
  FOREIGN KEY (`batchId`) REFERENCES `watermark_batches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
