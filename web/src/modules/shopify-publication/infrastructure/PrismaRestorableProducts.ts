import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { RestorableProductReader } from "../application/QueueProductRestores.ts";

export class PrismaRestorableProducts implements RestorableProductReader {
  constructor(private readonly prisma: PrismaClient) {}

  async listRestorableProductIds(shopDomain: string): Promise<Set<string>> {
    const shop = await this.prisma.shop.findUnique({
      where: { domain: shopDomain },
      select: { id: true },
    });
    if (!shop) return new Set();

    const [published, wmProducts] = await Promise.all([
      this.prisma.publishedMedia.findMany({
        where: { shopId: shop.id },
        select: { shopifyProductId: true },
      }),
      this.prisma.catalogProduct.findMany({
        where: { shopId: shop.id, imageUrl: { contains: "/wm-" } },
        select: { shopifyProductId: true },
      }),
    ]);
    return new Set([
      ...published.map((row) => row.shopifyProductId),
      ...wmProducts.map((row) => row.shopifyProductId),
    ]);
  }
}
