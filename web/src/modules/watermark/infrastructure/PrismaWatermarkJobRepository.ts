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
        layout: job.layout,
        rotation: job.rotation,
        offsetX: job.offsetX,
        offsetY: job.offsetY,
        fontFamily: job.fontFamily,
        fontSize: job.fontSize,
        textColor: job.textColor,
        strokeColor: job.strokeColor,
        strokeWidth: job.strokeWidth,
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
      | "TOP_CENTER"
      | "TOP_RIGHT"
      | "MIDDLE_LEFT"
      | "CENTER"
      | "MIDDLE_RIGHT"
      | "BOTTOM_LEFT"
      | "BOTTOM_CENTER"
      | "BOTTOM_RIGHT";
    opacity: number;
    layout: "SINGLE" | "TILED";
    rotation: number;
    offsetX: number;
    offsetY: number;
    fontFamily: string;
    fontSize: number;
    textColor: string;
    strokeColor: string;
    strokeWidth: number;
    status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
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
      configuration: {
        type: row.watermarkType,
        text: row.text,
        logoUrl: row.logoUrl,
        logoScale: row.logoScale,
        position: row.position,
        opacity: row.opacity,
        layout: row.layout,
        rotation: row.rotation,
        offsetX: row.offsetX,
        offsetY: row.offsetY,
        fontFamily: row.fontFamily as
          | "Arial"
          | "Helvetica"
          | "Georgia"
          | "Times New Roman"
          | "Courier New",
        fontSize: row.fontSize,
        textColor: row.textColor,
        strokeColor: row.strokeColor,
        strokeWidth: row.strokeWidth,
      },
      status: row.status,
      resultMediaId: row.resultMediaId,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
    });
  }
}
