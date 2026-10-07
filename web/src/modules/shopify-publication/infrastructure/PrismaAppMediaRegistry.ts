import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { AppMediaRegistry } from "../application/RestoreProductOriginal.ts";

export class PrismaAppMediaRegistry implements AppMediaRegistry {
  constructor(private readonly prisma: PrismaClient) {}

  async listAppMediaIds(shopDomain: string, productId: string): Promise<string[]> {
    const [published, attempts] = await Promise.all([
      this.prisma.publishedMedia.findMany({
        where: { shopifyProductId: productId, shop: { domain: shopDomain } },
        select: { shopifyMediaId: true },
      }),
      // Lần publish bị crash giữa chừng có thể đã upload ảnh nhưng chưa ghi PublishedMedia.
      this.prisma.publicationAttempt.findMany({
        where: {
          productId,
          shopifyMediaId: { not: null },
          shop: { domain: shopDomain },
        },
        select: { shopifyMediaId: true },
      }),
    ]);

    const ids = new Set<string>();
    for (const row of published) ids.add(row.shopifyMediaId);
    for (const row of attempts) {
      if (row.shopifyMediaId) ids.add(row.shopifyMediaId);
    }
    return Array.from(ids);
  }

  async forgetPublishedMedia(
    shopDomain: string,
    productId: string,
    mediaIds: string[],
  ): Promise<void> {
    if (mediaIds.length === 0) return;
    await this.prisma.publishedMedia.deleteMany({
      where: {
        shopifyProductId: productId,
        shopifyMediaId: { in: mediaIds },
        shop: { domain: shopDomain },
      },
    });
  }
}
