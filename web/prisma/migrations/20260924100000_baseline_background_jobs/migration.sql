-- Baseline: bảng `background_jobs` có trong DB dev (tạo bằng `prisma db push`)
-- nhưng chưa từng có migration nào tạo ra, trong khi 20260924103000_add_product_media_sync
-- đã `ALTER TABLE background_jobs`. Migration này dựng bảng ở trạng thái TRƯỚC migration
-- đó (chưa có `payloadVersion`, `processorVersion`; hai cột này do 20260924103000 thêm).
--
-- DB dev đã có sẵn bảng: đánh dấu đã áp dụng, không chạy lại:
--   npx prisma migrate resolve --applied 20260924100000_baseline_background_jobs

-- CreateTable
CREATE TABLE `background_jobs` (
  `id` VARCHAR(36) NOT NULL,
  `jobType` VARCHAR(50) NOT NULL,
  `payload` TEXT NOT NULL,
  `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `maxAttempts` INTEGER NOT NULL DEFAULT 3,
  `lastError` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `background_jobs_status_createdAt_idx`(`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
