-- AlterTable
ALTER TABLE `catalog_products`
  ADD COLUMN `productType` VARCHAR(255) NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX `catalog_products_shopId_productType_idx` ON `catalog_products`(`shopId`, `productType`);
