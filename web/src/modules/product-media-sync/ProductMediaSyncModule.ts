import { Module } from "@nestjs/common";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { PRISMA_CLIENT } from "../../shared/nest/tokens.ts";
import { EnqueueJob } from "../jobs/application/EnqueueJob.ts";
import { JobsModule } from "../jobs/JobsModule.ts";
import { ReceiveProductWebhook } from "./application/ReceiveProductWebhook.ts";
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
      provide: ReceiveProductWebhook,
      inject: [PrismaWebhookInboxRepository, EnqueueJob],
      useFactory: (inbox: PrismaWebhookInboxRepository, enqueueJob: EnqueueJob) =>
        new ReceiveProductWebhook(inbox, new BullMqProductReconcileQueue(enqueueJob)),
    },
    ProductMediaSyncJobHandlers,
  ],
  // ReceiveProductWebhook: main.ts cần để gắn webhook handler.
  // PrismaPublicationAttemptRepository: PublicationModule dùng khi publish ảnh.
  exports: [ReceiveProductWebhook, PrismaPublicationAttemptRepository],
})
export class ProductMediaSyncModule {}
