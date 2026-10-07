-- Baseline: bảng `watermark_templates` có trong DB dev (tạo bằng `prisma db push`)
-- nhưng chưa từng có migration nào tạo ra. 20261007110000_add_auto_watermark_rules đọc
-- template mặc định của shop để dựng rule, và bảng vẫn còn trong schema.prisma.
--
-- DB dev đã có sẵn bảng: đánh dấu đã áp dụng, không chạy lại:
--   npx prisma migrate resolve --applied 20261001110200_baseline_watermark_templates

-- CreateTable
CREATE TABLE `watermark_templates` (
  `id` VARCHAR(30) NOT NULL,
  `shopId` VARCHAR(30) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `config` TEXT NOT NULL,
  `isDefault` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `watermark_templates_shopId_idx`(`shopId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `watermark_templates`
  ADD CONSTRAINT `watermark_templates_shopId_fkey`
  FOREIGN KEY (`shopId`) REFERENCES `shops`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
