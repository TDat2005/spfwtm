import { Module } from "@nestjs/common";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { PRISMA_CLIENT } from "../../shared/nest/tokens.ts";
import { EnqueueJob } from "../jobs/application/EnqueueJob.ts";
import { JobsModule } from "../jobs/JobsModule.ts";
import { MediaService } from "../media/application/MediaService.ts";
import { MediaWatermarkGateway } from "../media/infrastructure/MediaWatermarkGateway.ts";
import { MediaModule } from "../media/MediaModule.ts";
import type { WatermarkBatchRepository } from "./application/BulkWatermarkPorts.ts";
import { CancelWatermarkBatch } from "./application/CancelWatermarkBatch.ts";
import { CancelWatermarkJob } from "./application/CancelWatermarkJob.ts";
import { CreateWatermarkBatch } from "./application/CreateWatermarkBatch.ts";
import { CreateWatermarkJob } from "./application/CreateWatermarkJob.ts";
import { GetWatermarkJob } from "./application/GetWatermarkJob.ts";
import { ListWatermarkBatches } from "./application/ListWatermarkBatches.ts";
import { ListWatermarkJobs } from "./application/ListWatermarkJobs.ts";
import { ProcessWatermarkJob } from "./application/ProcessWatermarkJob.ts";
import { RetryWatermarkJob } from "./application/RetryWatermarkJob.ts";
import type { WatermarkJobRepository } from "./application/WatermarkPorts.ts";
import { PrismaProductImageReader } from "./infrastructure/PrismaProductImageReader.ts";
import { PrismaWatermarkBatchRepository } from "./infrastructure/PrismaWatermarkBatchRepository.ts";
import { PrismaWatermarkJobRepository } from "./infrastructure/PrismaWatermarkJobRepository.ts";
import { SharpWatermarkProcessor } from "./infrastructure/SharpWatermarkProcessor.ts";
import { WatermarkJobHandlers } from "./infrastructure/WatermarkJobHandlers.ts";
import { WatermarkController } from "./presentation/WatermarkController.ts";

const WATERMARK_JOB_REPOSITORY = Symbol("WATERMARK_JOB_REPOSITORY");
const WATERMARK_BATCH_REPOSITORY = Symbol("WATERMARK_BATCH_REPOSITORY");

function useCaseWith<R, T>(token: symbol, useCase: new (repository: R) => T) {
  return {
    provide: useCase,
    inject: [token],
    useFactory: (repository: R) => new useCase(repository),
  };
}

@Module({
  imports: [MediaModule, JobsModule],
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
      useFactory: (repository: WatermarkJobRepository, mediaService: MediaService) =>
        new ProcessWatermarkJob(
          repository,
          new MediaWatermarkGateway(mediaService),
          new SharpWatermarkProcessor(),
        ),
    },
    useCaseWith(WATERMARK_JOB_REPOSITORY, ListWatermarkJobs),
    useCaseWith(WATERMARK_JOB_REPOSITORY, GetWatermarkJob),
    useCaseWith(WATERMARK_JOB_REPOSITORY, RetryWatermarkJob),
    useCaseWith(WATERMARK_JOB_REPOSITORY, CancelWatermarkJob),
    {
      provide: CreateWatermarkBatch,
      inject: [WATERMARK_BATCH_REPOSITORY, EnqueueJob],
      useFactory: (repository: WatermarkBatchRepository, enqueueJob: EnqueueJob) =>
        new CreateWatermarkBatch(repository, enqueueJob),
    },
    useCaseWith(WATERMARK_BATCH_REPOSITORY, ListWatermarkBatches),
    useCaseWith(WATERMARK_BATCH_REPOSITORY, CancelWatermarkBatch),
    WatermarkJobHandlers,
  ],
})
export class WatermarkModule {}
