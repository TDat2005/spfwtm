-- Baseline: các cột cấu hình watermark phẳng của `watermark_jobs` có trong DB dev
-- (tạo bằng `prisma db push`) nhưng chưa có migration nào thêm:
--   * `watermarkType`, `logoUrl`, `logoScale` (watermark dạng logo/ảnh)
--   * `text` đã được nới thành NULL (watermark ảnh không có chữ)
-- 20261007100000_add_watermark_designs đọc các cột này để gom thành `watermark_designs`
-- rồi bỏ chúng, nên phải có mặt trước migration đó.
--
-- DB dev đã có sẵn các cột: đánh dấu đã áp dụng, không chạy lại:
--   npx prisma migrate resolve --applied 20261001110000_baseline_watermark_job_logo_columns

-- AlterTable
ALTER TABLE `watermark_jobs`
  MODIFY `text` VARCHAR(100) NULL,
  ADD COLUMN `logoScale` DOUBLE NOT NULL DEFAULT 0.2,
  ADD COLUMN `logoUrl` TEXT NULL,
  ADD COLUMN `watermarkType` ENUM('TEXT', 'IMAGE') NOT NULL DEFAULT 'TEXT';
