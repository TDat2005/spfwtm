import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { ProductImageReader } from "../application/WatermarkPorts.ts";

export class PrismaProductImageReader implements ProductImageReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findImageUrl(
    shopDomain: string,
    productId: string
  ): Promise<string | null> {
    const product = await this.prisma.catalogProduct.findFirst({
      where: {
        shopifyProductId: productId,
        deletedAt: null,
        shop: { domain: shopDomain },
      },
      select: { imageUrl: true },
    });
    return product?.imageUrl ?? null;
  }
}
