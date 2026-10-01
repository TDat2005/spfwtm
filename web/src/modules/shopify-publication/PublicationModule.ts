import { Module } from "@nestjs/common";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { PRISMA_CLIENT, SHOPIFY, type ShopifyApp } from "../../shared/nest/tokens.ts";
import type { MediaStorage } from "../media/application/MediaPorts.ts";
import { MEDIA_STORAGE, MediaModule } from "../media/MediaModule.ts";
import { PrismaPublicationAttemptRepository } from "../product-media-sync/infrastructure/PrismaPublicationAttemptRepository.ts";
import { ProductMediaSyncModule } from "../product-media-sync/ProductMediaSyncModule.ts";
import { ListPublishedMedia } from "./application/ListPublishedMedia.ts";
import type { PublishedMediaRepository } from "./application/PublishedMediaRepository.ts";
import { PrismaPublishedMediaRepository } from "./infrastructure/PrismaPublishedMediaRepository.ts";
import { PrismaWatermarkResultReader } from "./infrastructure/PrismaWatermarkResultReader.ts";
import { PublicationUseCaseFactory } from "./infrastructure/PublicationUseCaseFactory.ts";
import { PublicationController } from "./presentation/PublicationController.ts";

const PUBLISHED_MEDIA_REPOSITORY = Symbol("PUBLISHED_MEDIA_REPOSITORY");

@Module({
  imports: [MediaModule, ProductMediaSyncModule],
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
        ),
    },
  ],
})
export class PublicationModule {}
