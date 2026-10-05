import { Module } from "@nestjs/common";
import { join } from "node:path";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { PRISMA_CLIENT } from "../../shared/nest/tokens.ts";
import type { MediaStorage } from "./application/MediaPorts.ts";
import { MediaService } from "./application/MediaService.ts";
import { FetchRemoteImageDownloader } from "./infrastructure/FetchRemoteImageDownloader.ts";
import { LocalMediaStorage } from "./infrastructure/LocalMediaStorage.ts";
import { PrismaMediaAssetRepository } from "./infrastructure/PrismaMediaAssetRepository.ts";
import { Sha256ContentHasher } from "./infrastructure/Sha256ContentHasher.ts";
import { MediaController } from "./presentation/MediaController.ts";

import { StorageCleanupService } from "./application/StorageCleanupService.ts";

export const MEDIA_STORAGE = Symbol("MEDIA_STORAGE");

@Module({
  controllers: [MediaController],
  providers: [
    {
      provide: MEDIA_STORAGE,
      useFactory: () => new LocalMediaStorage(join(process.cwd(), "storage", "media")),
    },
    {
      provide: MediaService,
      inject: [PRISMA_CLIENT, MEDIA_STORAGE],
      useFactory: (prisma: PrismaClient, storage: MediaStorage) =>
        new MediaService(
          new FetchRemoteImageDownloader(),
          storage,
          new Sha256ContentHasher(),
          new PrismaMediaAssetRepository(prisma),
        ),
    },
    {
      provide: StorageCleanupService,
      inject: [PRISMA_CLIENT, MEDIA_STORAGE],
      useFactory: (prisma: PrismaClient, storage: MediaStorage) =>
        new StorageCleanupService(prisma, storage),
    },
  ],
  exports: [MediaService, StorageCleanupService, MEDIA_STORAGE],
})
export class MediaModule {}
