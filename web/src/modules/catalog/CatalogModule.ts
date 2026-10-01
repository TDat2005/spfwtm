import { Module } from "@nestjs/common";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { PRISMA_CLIENT, SHOPIFY, type ShopifyApp } from "../../shared/nest/tokens.ts";
import { ListProducts } from "./application/ListProducts.ts";
import type { ProductRepository } from "./application/ProductRepository.ts";
import { PrismaProductRepository } from "./infrastructure/PrismaProductRepository.ts";
import { SyncCatalogFactory } from "./infrastructure/SyncCatalogFactory.ts";
import { CatalogController } from "./presentation/CatalogController.ts";

// Token cho port (interface). Interface biến mất khi chạy nên phải dùng Symbol.
const PRODUCT_REPOSITORY = Symbol("PRODUCT_REPOSITORY");

@Module({
  controllers: [CatalogController],
  providers: [
    {
      provide: PRODUCT_REPOSITORY,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient) => new PrismaProductRepository(prisma),
    },
    {
      provide: ListProducts,
      inject: [PRODUCT_REPOSITORY],
      useFactory: (repository: ProductRepository) => new ListProducts(repository),
    },
    {
      provide: SyncCatalogFactory,
      inject: [SHOPIFY, PRODUCT_REPOSITORY],
      useFactory: (shopify: ShopifyApp, repository: ProductRepository) =>
        new SyncCatalogFactory(shopify, repository),
    },
  ],
})
export class CatalogModule {}
