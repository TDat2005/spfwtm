import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { MediaStorage } from "./MediaPorts.ts";

export interface StorageCleanupResult {
  deletedAssetsCount: number;
  freedBytes: number;
}

export class StorageCleanupService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly mediaStorage: MediaStorage,
  ) {}

  async cleanupProcessedAssets(options?: {
    shopDomain?: string;
    olderThanDays?: number;
    onlyPublished?: boolean;
  }): Promise<StorageCleanupResult> {
    const olderThanDays = options?.olderThanDays ?? 7;
    const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const whereClause: Record<string, unknown> = {
      kind: "PROCESSED",
      createdAt: { lt: cutoffDate },
    };

    if (options?.shopDomain) {
      whereClause.shop = { domain: options.shopDomain };
    }

    if (options?.onlyPublished ?? true) {
      whereClause.resultForJobs = {
        some: {
          publishedMedia: { isNot: null },
        },
      };
    }

    const assets = await this.prisma.mediaAsset.findMany({
      where: whereClause,
      select: {
        id: true,
        storageKey: true,
        byteSize: true,
      },
    });

    let deletedAssetsCount = 0;
    let freedBytes = 0;

    for (const asset of assets) {
      try {
        const deleted = await this.mediaStorage.delete(asset.storageKey);
        if (deleted) {
          deletedAssetsCount++;
          freedBytes += asset.byteSize;
        }
      } catch {
        // Continue cleaning other assets without aborting
      }
    }

    return { deletedAssetsCount, freedBytes };
  }
}
