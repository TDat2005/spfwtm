-- Baseline: các cột có trong DB dev (tạo bằng `prisma db push`) nhưng chưa có migration nào thêm:
--   * `shops`.`autoWatermarkEnabled`: cờ auto-watermark cũ, 20261007110000_add_auto_watermark_rules
--     đọc rồi bỏ cột này nên phải có mặt trước migration đó
--   * `shops`.`uninstalledAt`: còn trong schema.prisma
--   * `catalog_products`.`originalImageUrl`: còn trong schema.prisma
--
-- DB dev đã có sẵn các cột: đánh dấu đã áp dụng, không chạy lại:
--   npx prisma migrate resolve --applied 20261001110100_baseline_shop_and_product_columns

-- AlterTable
ALTER TABLE `shops`
  ADD COLUMN `autoWatermarkEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `uninstalledAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `catalog_products`
  ADD COLUMN `originalImageUrl` TEXT NULL;
