import { Module } from "@nestjs/common";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { PRISMA_CLIENT, SHOPIFY, type ShopifyApp } from "../../shared/nest/tokens.ts";
import { EnqueueJob } from "../jobs/application/EnqueueJob.ts";
import { JobsModule } from "../jobs/JobsModule.ts";
import type { MediaStorage } from "../media/application/MediaPorts.ts";
import { MEDIA_STORAGE, MediaModule } from "../media/MediaModule.ts";
import { PrismaPublicationAttemptRepository } from "../product-media-sync/infrastructure/PrismaPublicationAttemptRepository.ts";
import { ProductMediaSyncModule } from "../product-media-sync/ProductMediaSyncModule.ts";
import { ListMatchingProductIds } from "../watermark/application/ListMatchingProductIds.ts";
import { WatermarkModule } from "../watermark/WatermarkModule.ts";
import { ListPublishedMedia } from "./application/ListPublishedMedia.ts";
import type { PublishedMediaRepository } from "./application/PublishedMediaRepository.ts";
import { QueueProductRestores } from "./application/QueueProductRestores.ts";
import { PrismaAppMediaRegistry } from "./infrastructure/PrismaAppMediaRegistry.ts";
import { PrismaCatalogRestoreWriter } from "./infrastructure/PrismaCatalogRestoreWriter.ts";
import { PrismaPublishedMediaRepository } from "./infrastructure/PrismaPublishedMediaRepository.ts";
import { PrismaRestorableProducts } from "./infrastructure/PrismaRestorableProducts.ts";
import { PrismaWatermarkResultReader } from "./infrastructure/PrismaWatermarkResultReader.ts";
import { PublicationJobHandlers } from "./infrastructure/PublicationJobHandlers.ts";
import { PublicationUseCaseFactory } from "./infrastructure/PublicationUseCaseFactory.ts";
import { PublicationController } from "./presentation/PublicationController.ts";

const PUBLISHED_MEDIA_REPOSITORY = Symbol("PUBLISHED_MEDIA_REPOSITORY");

@Module({
  // WatermarkModule: bộ lọc sản phẩm của studio cho "khôi phục tất cả khớp bộ lọc".
  imports: [JobsModule, MediaModule, ProductMediaSyncModule, WatermarkModule],
  controllers: [PublicationController],
  providers: [
    {
      provide: PUBLISHED_MEDIA_REPOSITORY,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient) => new PrismaPublishedMediaRepository(prisma),
    },
    {
      provide: ListPublishedMedia,
      inject: [PUBLISHED_MEDIA_REPOSITORY],
      useFactory: (repository: PublishedMediaRepository) => new ListPublishedMedia(repository),
    },
    {
      provide: PublicationUseCaseFactory,
      inject: [
        SHOPIFY,
        PRISMA_CLIENT,
        MEDIA_STORAGE,
        PUBLISHED_MEDIA_REPOSITORY,
        PrismaPublicationAttemptRepository,
      ],
      useFactory: (
        shopify: ShopifyApp,
        prisma: PrismaClient,
        mediaStorage: MediaStorage,
        publishedMedia: PublishedMediaRepository,
        publicationAttempts: PrismaPublicationAttemptRepository,
      ) =>
        new PublicationUseCaseFactory(
          shopify,
          new PrismaWatermarkResultReader(prisma, mediaStorage),
          publishedMedia,
          publicationAttempts,
          new PrismaAppMediaRegistry(prisma),
          new PrismaCatalogRestoreWriter(prisma),
        ),
    },
    {
      provide: QueueProductRestores,
      inject: [PRISMA_CLIENT, ListMatchingProductIds, EnqueueJob],
      useFactory: (
        prisma: PrismaClient,
        matching: ListMatchingProductIds,
        enqueueJob: EnqueueJob,
      ) => new QueueProductRestores(new PrismaRestorableProducts(prisma), matching, enqueueJob),
    },
    PublicationJobHandlers,
  ],
})
export class PublicationModule {}
