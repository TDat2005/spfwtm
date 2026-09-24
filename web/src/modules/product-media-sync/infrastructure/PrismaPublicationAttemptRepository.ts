import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type {
  PublicationAttemptRepository,
  StartPublicationAttemptInput,
} from "../application/PublicationAttemptRepository.ts";

export class PrismaPublicationAttemptRepository
  implements PublicationAttemptRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async start(input: StartPublicationAttemptInput): Promise<void> {
    const shop = await this.prisma.shop.findUnique({
      where: { domain: input.shopDomain },
      select: { id: true },
    });
    if (!shop) throw new Error("Không tìm thấy shop khi tạo publication attempt");

    const watermarkJob = await this.prisma.watermarkJob.findFirst({
      where: { id: input.watermarkJobId, shopId: shop.id },
      select: { id: true },
    });
    if (!watermarkJob) {
      throw new Error("Không tìm thấy watermark job khi tạo publication attempt");
    }

    await this.prisma.publicationAttempt.create({
      data: {
        id: input.id,
        shopId: shop.id,
        productId: input.productId,
        watermarkJobId: watermarkJob.id,
        status: "PUBLISHING",
      },
    });
  }

  async recordMedia(
    id: string,
    shopDomain: string,
    shopifyMediaId: string
  ): Promise<void> {
    await this.updateForShop(id, shopDomain, {
      shopifyMediaId,
      status: "PUBLISHING",
    });
  }

  async complete(id: string, shopDomain: string): Promise<void> {
    await this.updateForShop(id, shopDomain, {
      status: "PUBLISHED",
      completedAt: new Date(),
    });
  }

  async fail(id: string, shopDomain: string): Promise<void> {
    await this.updateForShop(id, shopDomain, {
      status: "FAILED",
      completedAt: new Date(),
    });
  }

  private async updateForShop(
    id: string,
    shopDomain: string,
    data: {
      shopifyMediaId?: string;
      status: "PUBLISHING" | "PUBLISHED" | "FAILED";
      completedAt?: Date;
    }
  ): Promise<void> {
    const result = await this.prisma.publicationAttempt.updateMany({
      where: { id, shop: { domain: shopDomain } },
      data,
    });
    if (result.count !== 1) throw new Error("Không tìm thấy publication attempt");
  }
}
