import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type {
  CatalogRestoreUpdate,
  CatalogRestoreWriter,
  CatalogSourceState,
} from "../application/RestoreProductOriginal.ts";

export class PrismaCatalogRestoreWriter implements CatalogRestoreWriter {
  constructor(private readonly prisma: PrismaClient) {}

  async findSource(
    shopDomain: string,
    productId: string,
  ): Promise<CatalogSourceState | null> {
    return this.prisma.catalogProduct.findFirst({
      where: { shopifyProductId: productId, shop: { domain: shopDomain } },
      select: { sourceMediaId: true, originalImageUrl: true },
    });
  }

  async applyRestore(
    shopDomain: string,
    productId: string,
    update: CatalogRestoreUpdate,
  ): Promise<void> {
    await this.prisma.catalogProduct.updateMany({
      where: { shopifyProductId: productId, shop: { domain: shopDomain } },
      data: toCatalogData(update),
    });
  }
}

function toCatalogData(update: CatalogRestoreUpdate) {
  switch (update.kind) {
    case "ORIGINAL_INTACT":
      // Cùng một ảnh gốc: giữ sourceMediaId và sourceVersion.
      return {
        imageUrl: update.imageUrl,
        originalImageUrl: update.imageUrl,
        needsReview: false,
      };
    case "SOURCE_ADOPTED":
      return {
        imageUrl: update.imageUrl,
        originalImageUrl: update.imageUrl,
        sourceMediaId: update.mediaId,
        sourceContentHash: null,
        needsReview: false,
        ...(update.sourceChanged ? { sourceVersion: { increment: 1 } } : {}),
      };
    case "NO_IMAGE":
      return {
        imageUrl: null,
        originalImageUrl: null,
        imageAltText: null,
        sourceMediaId: null,
        sourceContentHash: null,
        needsReview: true,
        ...(update.hadSource ? { sourceVersion: { increment: 1 } } : {}),
      };
  }
}
