import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { WatermarkJobRepository } from "../application/WatermarkPorts.ts";
import { WatermarkJob } from "../domain/WatermarkJob.ts";

export class PrismaWatermarkJobRepository implements WatermarkJobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(job: WatermarkJob): Promise<void> {
    const product = await this.prisma.catalogProduct.findFirst({
      where: {
        shopifyProductId: job.productId,
        shop: { domain: job.shopDomain },
      },
      select: { id: true, shopId: true },
    });
    if (!product) throw new Error("Sản phẩm chưa được đồng bộ");

    await this.prisma.watermarkJob.upsert({
      where: { id: job.id },
      create: {
        id: job.id,
        shopId: product.shopId,
        catalogProductId: product.id,
        sourceImageUrl: job.sourceImageUrl,
        watermarkType: job.watermarkType,
        text: job.text,
        logoUrl: job.logoUrl,
        logoScale: job.logoScale,
        position: job.position,
        opacity: job.opacity,
        status: job.status,
        resultMediaId: job.resultMediaId,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt,
      },
      update: {
        status: job.status,
        resultMediaId: job.resultMediaId,
        errorMessage: job.errorMessage,
      },
    });
  }

  async findByIdForShop(
    id: string,
    shopDomain: string
  ): Promise<WatermarkJob | null> {
    const row = await this.prisma.watermarkJob.findFirst({
      where: { id, shop: { domain: shopDomain } },
      include: { shop: true, product: true },
    });
    return row ? this.toDomain(row) : null;
  }

  async listByShop(shopDomain: string): Promise<WatermarkJob[]> {
    const rows = await this.prisma.watermarkJob.findMany({
      where: { shop: { domain: shopDomain } },
      include: { shop: true, product: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: {
    id: string;
    sourceImageUrl: string;
    watermarkType: "TEXT" | "IMAGE";
    text: string | null;
    logoUrl: string | null;
    logoScale: number;
    position:
      | "TOP_LEFT"
      | "TOP_RIGHT"
      | "CENTER"
      | "BOTTOM_LEFT"
      | "BOTTOM_RIGHT";
    opacity: number;
    status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
    resultMediaId: string | null;
    errorMessage: string | null;
    createdAt: Date;
    shop: { domain: string };
    product: { shopifyProductId: string };
  }): WatermarkJob {
    return new WatermarkJob({
      id: row.id,
      shopDomain: row.shop.domain,
      productId: row.product.shopifyProductId,
      sourceImageUrl: row.sourceImageUrl,
      watermarkType: row.watermarkType,
      text: row.text,
      logoUrl: row.logoUrl,
      logoScale: row.logoScale,
      position: row.position,
      opacity: row.opacity,
      status: row.status,
      resultMediaId: row.resultMediaId,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
    });
  }
}
