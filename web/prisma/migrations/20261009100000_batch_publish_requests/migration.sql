-- AlterTable
ALTER TABLE `watermark_batches` ADD COLUMN `publishRequestedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `publication_attempts_status_createdAt_idx` ON `publication_attempts`(`status`, `createdAt`);
