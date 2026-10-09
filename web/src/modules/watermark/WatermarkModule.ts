import { Module } from "@nestjs/common";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { PRISMA_CLIENT } from "../../shared/nest/tokens.ts";
import type { ShopCollectionsFactory } from "../catalog/application/CollectionGateway.ts";
import { CatalogModule } from "../catalog/CatalogModule.ts";
import { SHOP_COLLECTIONS } from "../catalog/tokens.ts";
import { EnqueueJob } from "../jobs/application/EnqueueJob.ts";
import { BullMqJobQueue } from "../jobs/infrastructure/BullMqJobQueue.ts";
import { JobsModule } from "../jobs/JobsModule.ts";
import { MediaService } from "../media/application/MediaService.ts";
import { MediaWatermarkGateway } from "../media/infrastructure/MediaWatermarkGateway.ts";
import { MediaModule } from "../media/MediaModule.ts";
import type { WatermarkBatchRepository } from "./application/BulkWatermarkPorts.ts";
import { CancelWatermarkBatch } from "./application/CancelWatermarkBatch.ts";
import { CancelWatermarkJob } from "./application/CancelWatermarkJob.ts";
import { CreateFilteredWatermarkBatches } from "./application/CreateFilteredWatermarkBatches.ts";
import { CreateWatermarkBatch } from "./application/CreateWatermarkBatch.ts";
import { CreateWatermarkJob } from "./application/CreateWatermarkJob.ts";
import { DispatchWatermarkBatch } from "./application/DispatchWatermarkBatch.ts";
import { EnqueueWatermarkJob } from "./application/EnqueueWatermarkJob.ts";
import { GetWatermarkJob } from "./application/GetWatermarkJob.ts";
import { ListMatchingProductIds } from "./application/ListMatchingProductIds.ts";
import { ListStudioProducts } from "./application/ListStudioProducts.ts";
import { ListWatermarkBatches } from "./application/ListWatermarkBatches.ts";
import { ListWatermarkJobs } from "./application/ListWatermarkJobs.ts";
import { ProcessWatermarkJob } from "./application/ProcessWatermarkJob.ts";
import { RecoverWatermarkJobs } from "./application/RecoverWatermarkJobs.ts";
import { RetryWatermarkJob } from "./application/RetryWatermarkJob.ts";
import type { WatermarkJobRepository } from "./application/WatermarkPorts.ts";
import type { WatermarkQueue } from "./application/WatermarkQueuePorts.ts";
import { BullMqWatermarkQueue } from "./infrastructure/BullMqWatermarkQueue.ts";
import { CachedCollectionProductLookup } from "./infrastructure/CachedCollectionProductLookup.ts";
import { PrismaCatalogFilterReader } from "./infrastructure/PrismaCatalogFilterReader.ts";
import { PrismaProductImageReader } from "./infrastructure/PrismaProductImageReader.ts";
import { PrismaWatermarkBatchRepository } from "./infrastructure/PrismaWatermarkBatchRepository.ts";
import { PrismaWatermarkJobRepository } from "./infrastructure/PrismaWatermarkJobRepository.ts";
import { PrismaWatermarkQueueRepository } from "./infrastructure/PrismaWatermarkQueueRepository.ts";
import {
  SharpWatermarkProcessor,
  configureSharpConcurrency,
} from "./infrastructure/SharpWatermarkProcessor.ts";
import { WatermarkJobHandlers } from "./infrastructure/WatermarkJobHandlers.ts";
import { WatermarkController } from "./presentation/WatermarkController.ts";

const WATERMARK_JOB_REPOSITORY = Symbol("WATERMARK_JOB_REPOSITORY");
const WATERMARK_BATCH_REPOSITORY = Symbol("WATERMARK_BATCH_REPOSITORY");
const WATERMARK_QUEUE_REPOSITORY = Symbol("WATERMARK_QUEUE_REPOSITORY");
const WATERMARK_QUEUE = Symbol("WATERMARK_QUEUE");

function useCaseWith<R, T>(token: symbol, useCase: new (repository: R) => T) {
  return {
    provide: useCase,
    inject: [token],
    useFactory: (repository: R) => new useCase(repository),
  };
}

@Module({
  imports: [CatalogModule, MediaModule, JobsModule],
  controllers: [WatermarkController],
  providers: [
    {
      provide: WATERMARK_JOB_REPOSITORY,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient) => new PrismaWatermarkJobRepository(prisma),
    },
    {
      provide: WATERMARK_BATCH_REPOSITORY,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient) => new PrismaWatermarkBatchRepository(prisma),
    },
    {
      provide: CreateWatermarkJob,
      inject: [WATERMARK_JOB_REPOSITORY, PRISMA_CLIENT],
      useFactory: (repository: WatermarkJobRepository, prisma: PrismaClient) =>
        new CreateWatermarkJob(repository, new PrismaProductImageReader(prisma)),
    },
    {
      provide: ProcessWatermarkJob,
      inject: [WATERMARK_JOB_REPOSITORY, MediaService],
      useFactory: (repository: WatermarkJobRepository, mediaService: MediaService) => {
        configureSharpConcurrency(process.env.SHARP_CONCURRENCY);
        return new ProcessWatermarkJob(
          repository,
          new MediaWatermarkGateway(mediaService),
          new SharpWatermarkProcessor(),
        );
      },
    },
    useCaseWith(WATERMARK_JOB_REPOSITORY, ListWatermarkJobs),
    useCaseWith(WATERMARK_JOB_REPOSITORY, GetWatermarkJob),
    useCaseWith(WATERMARK_JOB_REPOSITORY, RetryWatermarkJob),
    useCaseWith(WATERMARK_JOB_REPOSITORY, CancelWatermarkJob),
    {
      provide: WATERMARK_QUEUE_REPOSITORY,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient) => new PrismaWatermarkQueueRepository(prisma),
    },
    {
      provide: WATERMARK_QUEUE,
      inject: [EnqueueJob, BullMqJobQueue],
      useFactory: (enqueueJob: EnqueueJob, jobs: BullMqJobQueue) =>
        new BullMqWatermarkQueue(enqueueJob, jobs),
    },
    {
      provide: DispatchWatermarkBatch,
      inject: [WATERMARK_BATCH_REPOSITORY, WATERMARK_QUEUE],
      useFactory: (repository: PrismaWatermarkBatchRepository, queue: WatermarkQueue) =>
        new DispatchWatermarkBatch(repository, queue),
    },
    {
      provide: EnqueueWatermarkJob,
      inject: [WATERMARK_QUEUE_REPOSITORY, WATERMARK_QUEUE],
      useFactory: (repository: PrismaWatermarkQueueRepository, queue: WatermarkQueue) =>
        new EnqueueWatermarkJob(repository, queue),
    },
    {
      provide: RecoverWatermarkJobs,
      inject: [WATERMARK_QUEUE_REPOSITORY, WATERMARK_QUEUE],
      useFactory: (repository: PrismaWatermarkQueueRepository, queue: WatermarkQueue) =>
        new RecoverWatermarkJobs(repository, queue),
    },
    {
      provide: CreateWatermarkBatch,
      inject: [WATERMARK_BATCH_REPOSITORY, DispatchWatermarkBatch, SHOP_COLLECTIONS],
      useFactory: (
        repository: WatermarkBatchRepository,
        dispatcher: DispatchWatermarkBatch,
        collections: ShopCollectionsFactory,
      ) =>
        new CreateWatermarkBatch(repository, dispatcher, {
          listProductIds: async (shopDomain, collectionId) =>
            (await collections.forShop(shopDomain)).listProductIds(collectionId),
        }),
    },
    {
      provide: CreateFilteredWatermarkBatches,
      inject: [WATERMARK_BATCH_REPOSITORY, DispatchWatermarkBatch, SHOP_COLLECTIONS, PRISMA_CLIENT],
      useFactory: (
        repository: WatermarkBatchRepository,
        dispatcher: DispatchWatermarkBatch,
        collections: ShopCollectionsFactory,
        prisma: PrismaClient,
      ) =>
        new CreateFilteredWatermarkBatches(
          repository,
          dispatcher,
          {
            listProductIds: async (shopDomain, collectionId) =>
              (await collections.forShop(shopDomain)).listProductIds(collectionId),
          },
          new PrismaCatalogFilterReader(prisma),
        ),
    },
    {
      provide: ListMatchingProductIds,
      inject: [SHOP_COLLECTIONS, PRISMA_CLIENT],
      useFactory: (collections: ShopCollectionsFactory, prisma: PrismaClient) =>
        new ListMatchingProductIds(new PrismaCatalogFilterReader(prisma), {
          listProductIds: async (shopDomain, collectionId) =>
            (await collections.forShop(shopDomain)).listProductIds(collectionId),
        }),
    },
    {
      provide: ListStudioProducts,
      inject: [SHOP_COLLECTIONS, PRISMA_CLIENT],
      useFactory: (collections: ShopCollectionsFactory, prisma: PrismaClient) =>
        new ListStudioProducts(
          new PrismaCatalogFilterReader(prisma),
          new CachedCollectionProductLookup({
            listProductIds: async (shopDomain, collectionId) =>
              (await collections.forShop(shopDomain)).listProductIds(collectionId),
          }),
        ),
    },
    useCaseWith(WATERMARK_BATCH_REPOSITORY, ListWatermarkBatches),
    useCaseWith(WATERMARK_BATCH_REPOSITORY, CancelWatermarkBatch),
    WatermarkJobHandlers,
  ],
  exports: [DispatchWatermarkBatch, EnqueueWatermarkJob, ListMatchingProductIds],
})
export class WatermarkModule {}
