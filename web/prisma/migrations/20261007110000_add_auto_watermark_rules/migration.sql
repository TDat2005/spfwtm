-- CreateTable
CREATE TABLE `auto_watermark_rules` (
  `id` VARCHAR(36) NOT NULL,
  `shopId` VARCHAR(30) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `priority` INTEGER NOT NULL DEFAULT 0,
  `scope` ENUM('ALL', 'COLLECTION', 'PRODUCT_TYPE') NOT NULL,
  `scopeValue` VARCHAR(255) NULL,
  `scopeLabel` VARCHAR(255) NULL,
  `designId` VARCHAR(36) NOT NULL,
  `onNewProduct` BOOLEAN NOT NULL DEFAULT true,
  `onPrimaryChanged` BOOLEAN NOT NULL DEFAULT false,
  `syncScope` BOOLEAN NOT NULL DEFAULT false,
  `autoPublish` BOOLEAN NOT NULL DEFAULT false,
  `lastAppliedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `auto_watermark_rules_shopId_enabled_idx`(`shopId`, `enabled`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `catalog_products`
  ADD COLUMN `autoRuleId` VARCHAR(36) NULL,
  ADD COLUMN `autoDesignId` VARCHAR(36) NULL,
  ADD COLUMN `autoSourceVersion` INTEGER NULL;

ALTER TABLE `watermark_jobs`
  ADD COLUMN `ruleId` VARCHAR(36) NULL,
  ADD COLUMN `publishOnComplete` BOOLEAN NOT NULL DEFAULT false;

-- Backfill: shop đang bật auto-watermark (cờ cũ + template mặc định) thành một
-- rule phạm vi cả shop, chỉ chạy khi có sản phẩm mới, giữ đúng hành vi cũ.
CREATE TEMPORARY TABLE `tmp_auto_rules` (
  `shopId` VARCHAR(30) NOT NULL,
  `templateName` VARCHAR(255) NOT NULL,
  `layers` LONGTEXT NOT NULL,
  `contentHash` CHAR(64) NULL,
  PRIMARY KEY (`shopId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `tmp_auto_rules` (`shopId`, `templateName`, `layers`)
SELECT
  `t`.`shopId`,
  `t`.`name`,
  CASE
    WHEN JSON_CONTAINS_PATH(`t`.`config`, 'one', '$.layers') THEN `t`.`config`
    ELSE CAST(JSON_OBJECT(
      'version', 2,
      'layers', JSON_ARRAY(JSON_MERGE_PATCH(
        CAST(`t`.`config` AS JSON),
        JSON_OBJECT(
          'enabled', TRUE,
          'type', COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(`t`.`config`, '$.watermarkType')),
            JSON_UNQUOTE(JSON_EXTRACT(`t`.`config`, '$.type')),
            'TEXT'
          )
        )
      ))
    ) AS CHAR)
  END
FROM `watermark_templates` AS `t`
JOIN `shops` AS `s` ON `s`.`id` = `t`.`shopId`
JOIN (
  SELECT `shopId`, MIN(`id`) AS `templateId`
  FROM `watermark_templates`
  WHERE `isDefault` = true AND JSON_VALID(`config`)
  GROUP BY `shopId`
) AS `d` ON `d`.`templateId` = `t`.`id`
WHERE `s`.`autoWatermarkEnabled` = true;

UPDATE `tmp_auto_rules` SET `contentHash` = SHA2(`layers`, 256);

INSERT IGNORE INTO `watermark_designs` (`id`, `shopId`, `contentHash`, `layers`)
SELECT UUID(), `shopId`, `contentHash`, `layers` FROM `tmp_auto_rules`;

INSERT INTO `auto_watermark_rules` (
  `id`, `shopId`, `name`, `enabled`, `priority`, `scope`, `designId`,
  `onNewProduct`, `onPrimaryChanged`, `syncScope`, `autoPublish`, `updatedAt`
)
SELECT
  UUID(),
  `r`.`shopId`,
  LEFT(CONCAT('Sản phẩm mới: ', `r`.`templateName`), 255),
  true,
  0,
  'ALL',
  `d`.`id`,
  true,
  false,
  false,
  false,
  CURRENT_TIMESTAMP(3)
FROM `tmp_auto_rules` AS `r`
JOIN `watermark_designs` AS `d`
  ON `d`.`shopId` = `r`.`shopId` AND `d`.`contentHash` = `r`.`contentHash`;

DROP TEMPORARY TABLE `tmp_auto_rules`;

ALTER TABLE `shops` DROP COLUMN `autoWatermarkEnabled`;

-- AddForeignKey
ALTER TABLE `auto_watermark_rules`
  ADD CONSTRAINT `auto_watermark_rules_shopId_fkey`
  FOREIGN KEY (`shopId`) REFERENCES `shops`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `auto_watermark_rules`
  ADD CONSTRAINT `auto_watermark_rules_designId_fkey`
  FOREIGN KEY (`designId`) REFERENCES `watermark_designs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `watermark_jobs`
  ADD CONSTRAINT `watermark_jobs_ruleId_fkey`
  FOREIGN KEY (`ruleId`) REFERENCES `auto_watermark_rules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
