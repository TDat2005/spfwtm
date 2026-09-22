import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { MediaAssetRepository } from "../application/MediaPorts.ts";
import { MediaAsset } from "../domain/MediaAsset.ts";

export class PrismaMediaAssetRepository implements MediaAssetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(asset: MediaAsset): Promise<void> {
    const shop = await this.prisma.shop.upsert({
      where: { domain: asset.shopDomain },
      create: { domain: asset.shopDomain },
      update: {},
    });
    await this.prisma.mediaAsset.upsert({
      where: { id: asset.id },
      create: {
        id: asset.id,
        shopId: shop.id,
        kind: asset.kind,
        storageKey: asset.storageKey,
        sourceUrl: asset.sourceUrl,
        mimeType: asset.mimeType,
        contentHash: asset.contentHash,
        byteSize: asset.byteSize,
        createdAt: asset.createdAt,
      },
      update: {},
    });
  }

  async findByIdForShop(
    id: string,
    shopDomain: string
  ): Promise<MediaAsset | null> {
    const row = await this.prisma.mediaAsset.findFirst({
      where: { id, shop: { domain: shopDomain } },
      include: { shop: true },
    });
    return row
      ? new MediaAsset({
          id: row.id,
          shopDomain: row.shop.domain,
          kind: row.kind,
          storageKey: row.storageKey,
          sourceUrl: row.sourceUrl,
          mimeType: row.mimeType,
          contentHash: row.contentHash,
          byteSize: row.byteSize,
          createdAt: row.createdAt,
        })
      : null;
  }
}
