import { Module } from "@nestjs/common";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { PRISMA_CLIENT } from "../../shared/nest/tokens.ts";
import { EnqueueJob } from "../jobs/application/EnqueueJob.ts";
import { BullMqJobQueue } from "../jobs/infrastructure/BullMqJobQueue.ts";
import { JobsModule } from "../jobs/JobsModule.ts";
import { ReceiveProductWebhook } from "./application/ReceiveProductWebhook.ts";
import { RecoverMediaSync } from "./application/RecoverMediaSync.ts";
import { BullMqProductReconcileQueue } from "./infrastructure/BullMqProductReconcileQueue.ts";
import { PrismaPublicationAttemptRepository } from "./infrastructure/PrismaPublicationAttemptRepository.ts";
import { PrismaWebhookInboxRepository } from "./infrastructure/PrismaWebhookInboxRepository.ts";
import { ProductMediaSyncJobHandlers } from "./infrastructure/ProductMediaSyncJobHandlers.ts";

@Module({
  imports: [JobsModule],
  providers: [
    {
      provide: PrismaWebhookInboxRepository,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient) => new PrismaWebhookInboxRepository(prisma),
    },
    {
      provide: PrismaPublicationAttemptRepository,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient) => new PrismaPublicationAttemptRepository(prisma),
    },
    {
      provide: BullMqProductReconcileQueue,
      inject: [EnqueueJob, BullMqJobQueue],
      useFactory: (enqueueJob: EnqueueJob, jobs: BullMqJobQueue) =>
        new BullMqProductReconcileQueue(enqueueJob, jobs),
    },
    {
      provide: ReceiveProductWebhook,
      inject: [PrismaWebhookInboxRepository, BullMqProductReconcileQueue],
      useFactory: (inbox: PrismaWebhookInboxRepository, queue: BullMqProductReconcileQueue) =>
        new ReceiveProductWebhook(inbox, queue),
    },
    {
      provide: RecoverMediaSync,
      inject: [
        PrismaWebhookInboxRepository,
        PrismaPublicationAttemptRepository,
        BullMqProductReconcileQueue,
      ],
      useFactory: (
        inbox: PrismaWebhookInboxRepository,
        attempts: PrismaPublicationAttemptRepository,
        queue: BullMqProductReconcileQueue,
      ) => new RecoverMediaSync(inbox, attempts, queue),
    },
    ProductMediaSyncJobHandlers,
  ],
  exports: [ReceiveProductWebhook, PrismaPublicationAttemptRepository],
})
export class ProductMediaSyncModule {}
