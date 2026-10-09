-- Trước đây job lẻ không ghi enqueuedAt. Job lẻ còn PENDING coi như đã vào queue
-- lúc tạo, để RecoverWatermarkJobs đưa lại nếu chúng đã bị mất khỏi queue.
UPDATE `watermark_jobs` SET `enqueuedAt` = `createdAt`
WHERE `batchId` IS NULL AND `enqueuedAt` IS NULL AND `status` = 'PENDING';

-- CreateIndex
CREATE INDEX `watermark_jobs_shopId_status_enqueuedAt_idx` ON `watermark_jobs`(`shopId`, `status`, `enqueuedAt`);

-- CreateIndex
CREATE INDEX `watermark_jobs_status_enqueuedAt_idx` ON `watermark_jobs`(`status`, `enqueuedAt`);

-- DropIndex
DROP INDEX `watermark_jobs_shopId_status_idx` ON `watermark_jobs`;
