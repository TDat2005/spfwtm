-- CreateTable
CREATE TABLE `watermark_designs` (
  `id` VARCHAR(36) NOT NULL,
  `shopId` VARCHAR(30) NOT NULL,
  `contentHash` CHAR(64) NOT NULL,
  `layers` LONGTEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `watermark_designs_shopId_contentHash_key`(`shopId`, `contentHash`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `watermark_jobs` ADD COLUMN `designId` VARCHAR(36) NULL;
ALTER TABLE `watermark_batches` ADD COLUMN `designId` VARCHAR(36) NULL;

-- Backfill: mỗi cấu hình phẳng cũ thành một design có 1 lớp.
-- Cấu hình trùng nhau trong cùng shop dùng chung một design.
CREATE TEMPORARY TABLE `tmp_job_designs` (
  `jobId` VARCHAR(36) NOT NULL,
  `shopId` VARCHAR(30) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `layers` LONGTEXT NOT NULL,
  `contentHash` CHAR(64) NULL,
  PRIMARY KEY (`jobId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `tmp_job_designs` (`jobId`, `shopId`, `createdAt`, `layers`)
SELECT
  `id`,
  `shopId`,
  `createdAt`,
  CAST(JSON_OBJECT(
    'version', 2,
    'layers', JSON_ARRAY(JSON_OBJECT(
      'enabled', TRUE,
      'type', `watermarkType`,
      'text', `text`,
      'logoUrl', `logoUrl`,
      'logoScale', `logoScale`,
      'position', `position`,
      'opacity', `opacity`,
      'layout', `layout`,
      'rotation', `rotation`,
      'offsetX', `offsetX`,
      'offsetY', `offsetY`,
      'fontFamily', `fontFamily`,
      'fontSize', `fontSize`,
      'textColor', `textColor`,
      'strokeColor', `strokeColor`,
      'strokeWidth', `strokeWidth`
    ))
  ) AS CHAR)
FROM `watermark_jobs`;

UPDATE `tmp_job_designs` SET `contentHash` = SHA2(`layers`, 256);

INSERT INTO `watermark_designs` (`id`, `shopId`, `contentHash`, `layers`, `createdAt`)
SELECT UUID(), `shopId`, `contentHash`, MIN(`layers`), MIN(`createdAt`)
FROM `tmp_job_designs`
GROUP BY `shopId`, `contentHash`;

UPDATE `watermark_jobs` AS `j`
  JOIN `tmp_job_designs` AS `t` ON `t`.`jobId` = `j`.`id`
  JOIN `watermark_designs` AS `d`
    ON `d`.`shopId` = `t`.`shopId` AND `d`.`contentHash` = `t`.`contentHash`
SET `j`.`designId` = `d`.`id`;

UPDATE `watermark_batches` AS `b`
  JOIN (
    SELECT `batchId`, MIN(`designId`) AS `designId`
    FROM `watermark_jobs`
    WHERE `batchId` IS NOT NULL
    GROUP BY `batchId`
  ) AS `x` ON `x`.`batchId` = `b`.`id`
SET `b`.`designId` = `x`.`designId`;

DROP TEMPORARY TABLE `tmp_job_designs`;

-- AlterTable: designId bắt buộc, bỏ các cột cấu hình phẳng
ALTER TABLE `watermark_jobs`
  MODIFY `designId` VARCHAR(36) NOT NULL,
  DROP COLUMN `watermarkType`,
  DROP COLUMN `text`,
  DROP COLUMN `logoUrl`,
  DROP COLUMN `logoScale`,
  DROP COLUMN `position`,
  DROP COLUMN `opacity`,
  DROP COLUMN `layout`,
  DROP COLUMN `rotation`,
  DROP COLUMN `offsetX`,
  DROP COLUMN `offsetY`,
  DROP COLUMN `fontFamily`,
  DROP COLUMN `fontSize`,
  DROP COLUMN `textColor`,
  DROP COLUMN `strokeColor`,
  DROP COLUMN `strokeWidth`;

-- AddForeignKey
ALTER TABLE `watermark_designs`
  ADD CONSTRAINT `watermark_designs_shopId_fkey`
  FOREIGN KEY (`shopId`) REFERENCES `shops`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `watermark_jobs`
  ADD CONSTRAINT `watermark_jobs_designId_fkey`
  FOREIGN KEY (`designId`) REFERENCES `watermark_designs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `watermark_batches`
  ADD CONSTRAINT `watermark_batches_designId_fkey`
  FOREIGN KEY (`designId`) REFERENCES `watermark_designs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
