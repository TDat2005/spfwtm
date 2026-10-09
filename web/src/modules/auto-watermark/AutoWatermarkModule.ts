import { Module } from "@nestjs/common";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { PRISMA_CLIENT } from "../../shared/nest/tokens.ts";
import { CatalogModule } from "../catalog/CatalogModule.ts";
import { EnqueueJob } from "../jobs/application/EnqueueJob.ts";
import { JobsModule } from "../jobs/JobsModule.ts";
import { DispatchWatermarkBatch } from "../watermark/application/DispatchWatermarkBatch.ts";
import { EnqueueWatermarkJob } from "../watermark/application/EnqueueWatermarkJob.ts";
import { WatermarkModule } from "../watermark/WatermarkModule.ts";
import { ApplyAutoWatermarkRules } from "./application/ApplyAutoWatermarkRules.ts";
import type {
  AutoWatermarkApplyQueue,
  ShopCollectionsFactory,
} from "./application/AutoWatermarkPorts.ts";
import { EvaluateProductRules } from "./application/EvaluateProductRules.ts";
import { ManageAutoWatermarkRules } from "./application/ManageAutoWatermarkRules.ts";
import {
  BullMqAutoWatermarkApplyQueue,
  BullMqAutoWatermarkJobQueue,
  BullMqAutoWatermarkRestoreQueue,
  PrismaWatermarkDesignStore,
} from "./infrastructure/AutoWatermarkAdapters.ts";
import { AutoWatermarkJobHandlers } from "./infrastructure/AutoWatermarkJobHandlers.ts";
import { PrismaAutoWatermarkRepository } from "./infrastructure/PrismaAutoWatermarkRepository.ts";
import { AutoWatermarkController } from "./presentation/AutoWatermarkController.ts";
import { AUTO_WATERMARK_APPLY_QUEUE, AUTO_WATERMARK_RULES, SHOP_COLLECTIONS } from "./tokens.ts";

const AUTO_WATERMARK_JOB_QUEUE = Symbol("AUTO_WATERMARK_JOB_QUEUE");

@Module({
  imports: [CatalogModule, JobsModule, WatermarkModule],
  controllers: [AutoWatermarkController],
  providers: [
    {
      provide: AUTO_WATERMARK_RULES,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient) => new PrismaAutoWatermarkRepository(prisma),
    },
    {
      provide: AUTO_WATERMARK_APPLY_QUEUE,
      inject: [EnqueueJob],
      useFactory: (enqueue: EnqueueJob) => new BullMqAutoWatermarkApplyQueue(enqueue),
    },
    {
      provide: AUTO_WATERMARK_JOB_QUEUE,
      inject: [EnqueueWatermarkJob, DispatchWatermarkBatch],
      useFactory: (enqueue: EnqueueWatermarkJob, dispatcher: DispatchWatermarkBatch) =>
        new BullMqAutoWatermarkJobQueue(enqueue, dispatcher),
    },
    {
      provide: EvaluateProductRules,
      inject: [AUTO_WATERMARK_RULES, SHOP_COLLECTIONS, AUTO_WATERMARK_JOB_QUEUE],
      useFactory: (
        repository: PrismaAutoWatermarkRepository,
        collections: ShopCollectionsFactory,
        queue: BullMqAutoWatermarkJobQueue,
      ) => new EvaluateProductRules(repository, repository, collections, repository, queue),
    },
    {
      provide: ApplyAutoWatermarkRules,
      inject: [AUTO_WATERMARK_RULES, SHOP_COLLECTIONS, AUTO_WATERMARK_JOB_QUEUE, EnqueueJob],
      useFactory: (
        repository: PrismaAutoWatermarkRepository,
        collections: ShopCollectionsFactory,
        queue: BullMqAutoWatermarkJobQueue,
        enqueue: EnqueueJob,
      ) =>
        new ApplyAutoWatermarkRules(
          repository,
          repository,
          collections,
          repository,
          queue,
          new BullMqAutoWatermarkRestoreQueue(enqueue),
        ),
    },
    {
      provide: ManageAutoWatermarkRules,
      inject: [AUTO_WATERMARK_RULES, PRISMA_CLIENT, SHOP_COLLECTIONS, AUTO_WATERMARK_APPLY_QUEUE],
      useFactory: (
        repository: PrismaAutoWatermarkRepository,
        prisma: PrismaClient,
        collections: ShopCollectionsFactory,
        applyQueue: AutoWatermarkApplyQueue,
      ) =>
        new ManageAutoWatermarkRules(
          repository,
          new PrismaWatermarkDesignStore(prisma),
          collections,
          applyQueue,
        ),
    },
    AutoWatermarkJobHandlers,
  ],
})
export class AutoWatermarkModule {}
