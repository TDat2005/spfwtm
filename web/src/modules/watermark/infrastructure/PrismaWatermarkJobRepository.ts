import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { WatermarkJobRepository } from "../application/WatermarkPorts.ts";
import { WatermarkJob, type WatermarkJobStatus } from "../domain/WatermarkJob.ts";
import { readWatermarkDesign, saveWatermarkDesign } from "./PrismaWatermarkDesigns.ts";

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

    const existing = await this.prisma.watermarkJob.findUnique({
      where: { id: job.id },
      select: { id: true },
    });
    if (existing) {
      // Design bất biến: sau khi tạo, job chỉ đổi trạng thái.
      await this.prisma.watermarkJob.update({
        where: { id: job.id },
        data: {
          status: job.status,
          resultMediaId: job.resultMediaId,
          errorMessage: job.errorMessage,
        },
      });
    } else {
      const designId = await saveWatermarkDesign(this.prisma, product.shopId, job.design);
      await this.prisma.watermarkJob.create({
        data: {
          id: job.id,
          shopId: product.shopId,
          catalogProductId: product.id,
          sourceImageUrl: job.sourceImageUrl,
          designId,
          publishOnComplete: job.publishOnComplete,
          status: job.status,
          resultMediaId: job.resultMediaId,
          errorMessage: job.errorMessage,
          createdAt: job.createdAt,
        },
      });
    }

    if (job.status === "COMPLETED") {
      await this.prisma.catalogProduct.updateMany({
        where: {
          id: product.id,
          imageUrl: job.sourceImageUrl,
        },
        data: { needsReview: false },
      });
    }
  }

  async findByIdForShop(
    id: string,
    shopDomain: string
  ): Promise<WatermarkJob | null> {
    const row = await this.prisma.watermarkJob.findFirst({
      where: { id, shop: { domain: shopDomain } },
      include: JOB_INCLUDE,
    });
    return row ? this.toDomain(row) : null;
  }

  async listByShop(shopDomain: string): Promise<WatermarkJob[]> {
    const rows = await this.prisma.watermarkJob.findMany({
      where: { shop: { domain: shopDomain } },
      include: JOB_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: {
    id: string;
    sourceImageUrl: string;
    publishOnComplete: boolean;
    status: WatermarkJobStatus;
    resultMediaId: string | null;
    errorMessage: string | null;
    createdAt: Date;
    shop: { domain: string };
    product: { shopifyProductId: string };
    design: { layers: string };
  }): WatermarkJob {
    return new WatermarkJob({
      id: row.id,
      shopDomain: row.shop.domain,
      productId: row.product.shopifyProductId,
      sourceImageUrl: row.sourceImageUrl,
      design: readWatermarkDesign(row.design),
      publishOnComplete: row.publishOnComplete,
      status: row.status,
      resultMediaId: row.resultMediaId,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
    });
  }
}

const JOB_INCLUDE = {
  shop: { select: { domain: true } },
  product: { select: { shopifyProductId: true } },
  design: { select: { layers: true } },
} as const;
