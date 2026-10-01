import { Module } from "@nestjs/common";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { PRISMA_CLIENT, SHOPIFY, type ShopifyApp } from "../../shared/nest/tokens.ts";
import { EnqueueJob } from "../jobs/application/EnqueueJob.ts";
import { JobsModule } from "../jobs/JobsModule.ts";
import type { CatalogSyncRepository } from "./application/CatalogSyncPorts.ts";
import { GetCatalogSyncStatus } from "./application/GetCatalogSyncStatus.ts";
import { ListProducts } from "./application/ListProducts.ts";
import type { ProductRepository } from "./application/ProductRepository.ts";
import { StartCatalogSync } from "./application/StartCatalogSync.ts";
import { SyncCatalogPage } from "./application/SyncCatalogPage.ts";
import { BullMqCatalogSyncQueue } from "./infrastructure/BullMqCatalogSyncQueue.ts";
import { CatalogSyncJobHandlers } from "./infrastructure/CatalogSyncJobHandlers.ts";
import { PrismaCatalogSyncRepository } from "./infrastructure/PrismaCatalogSyncRepository.ts";
import { PrismaProductRepository } from "./infrastructure/PrismaProductRepository.ts";
import { ShopifyProductGatewayFactory } from "./infrastructure/ShopifyProductGatewayFactory.ts";
import { CatalogController } from "./presentation/CatalogController.ts";
import { CATALOG_SYNC_REPOSITORY, PRODUCT_REPOSITORY } from "./tokens.ts";

@Module({
  imports: [JobsModule],
  controllers: [CatalogController],
  providers: [
    {
      provide: PRODUCT_REPOSITORY,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient) => new PrismaProductRepository(prisma),
    },
    {
      provide: CATALOG_SYNC_REPOSITORY,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient) => new PrismaCatalogSyncRepository(prisma),
    },
    {
      provide: ListProducts,
      inject: [PRODUCT_REPOSITORY],
      useFactory: (repository: ProductRepository) => new ListProducts(repository),
    },
    {
      provide: GetCatalogSyncStatus,
      inject: [CATALOG_SYNC_REPOSITORY],
      useFactory: (repository: CatalogSyncRepository) => new GetCatalogSyncStatus(repository),
    },
    {
      provide: StartCatalogSync,
      inject: [CATALOG_SYNC_REPOSITORY, EnqueueJob],
      useFactory: (repository: CatalogSyncRepository, enqueueJob: EnqueueJob) =>
        new StartCatalogSync(repository, new BullMqCatalogSyncQueue(enqueueJob)),
    },
    {
      provide: SyncCatalogPage,
      inject: [SHOPIFY, PRODUCT_REPOSITORY, CATALOG_SYNC_REPOSITORY, EnqueueJob],
      useFactory: (
        shopify: ShopifyApp,
        products: ProductRepository,
        syncs: CatalogSyncRepository,
        enqueueJob: EnqueueJob,
      ) =>
        new SyncCatalogPage(
          new ShopifyProductGatewayFactory(shopify),
          products,
          syncs,
          new BullMqCatalogSyncQueue(enqueueJob),
        ),
    },
    CatalogSyncJobHandlers,
  ],
})
export class CatalogModule {}
