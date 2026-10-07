-- AlterTable
ALTER TABLE `watermark_jobs` ADD COLUMN `enqueuedAt` DATETIME(3) NULL;

-- Trước khi có dispatcher, mọi job của batch đều đã được đưa vào queue ngay lúc tạo.
UPDATE `watermark_jobs` SET `enqueuedAt` = `createdAt` WHERE `batchId` IS NOT NULL;

-- CreateIndex
CREATE INDEX `watermark_jobs_batchId_status_enqueuedAt_idx` ON `watermark_jobs`(`batchId`, `status`, `enqueuedAt`);

-- DropIndex
DROP INDEX `watermark_jobs_batchId_status_idx` ON `watermark_jobs`;
