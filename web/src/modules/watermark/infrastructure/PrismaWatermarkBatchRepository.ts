import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type {
  CreatedWatermarkBatch,
  WatermarkBatchRepository,
  WatermarkBatchStatus,
  WatermarkBatchSummary,
} from "../application/BulkWatermarkPorts.ts";
import type { WatermarkConfiguration } from "../domain/WatermarkConfiguration.ts";

export class PrismaWatermarkBatchRepository
  implements WatermarkBatchRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: {
    shopDomain: string;
    productIds: string[];
    configuration: WatermarkConfiguration;
  }): Promise<CreatedWatermarkBatch> {
    return this.prisma.$transaction(async (transaction) => {
      const shop = await transaction.shop.findUnique({
        where: { domain: input.shopDomain },
        select: { id: true },
      });
      if (!shop) throw new Error("Shop chưa đồng bộ catalog");

      const products = await transaction.catalogProduct.findMany({
        where: {
          shopId: shop.id,
          shopifyProductId: { in: input.productIds },
          deletedAt: null,
        },
        select: {
          id: true,
          shopifyProductId: true,
          imageUrl: true,
        },
      });
      const byProductId = new Map(
        products.map((product) => [product.shopifyProductId, product])
      );
      const unavailable = input.productIds.filter(
        (id) => !byProductId.get(id)?.imageUrl
      );
      if (unavailable.length > 0) {
        throw new Error(
          `${unavailable.length} sản phẩm chưa đồng bộ hoặc không có ảnh nguồn`
        );
      }

      const batchId = randomUUID();
      const createdAt = new Date();
      const jobs = input.productIds.map((productId) => {
        const product = byProductId.get(productId)!;
        return {
          id: randomUUID(),
          productId,
          catalogProductId: product.id,
          sourceImageUrl: product.imageUrl!,
        };
      });

      await transaction.watermarkBatch.create({
        data: {
          id: batchId,
          shopId: shop.id,
          totalJobs: jobs.length,
          createdAt,
        },
      });
      await transaction.watermarkJob.createMany({
        data: jobs.map((job) => ({
          id: job.id,
          shopId: shop.id,
          catalogProductId: job.catalogProductId,
          batchId,
          sourceImageUrl: job.sourceImageUrl,
          watermarkType: input.configuration.type,
          text: input.configuration.text,
          logoUrl: input.configuration.logoUrl,
          logoScale: input.configuration.logoScale,
          position: input.configuration.position,
          opacity: input.configuration.opacity,
          layout: input.configuration.layout,
          rotation: input.configuration.rotation,
          offsetX: input.configuration.offsetX,
          offsetY: input.configuration.offsetY,
          fontFamily: input.configuration.fontFamily,
          fontSize: input.configuration.fontSize,
          textColor: input.configuration.textColor,
          strokeColor: input.configuration.strokeColor,
          strokeWidth: input.configuration.strokeWidth,
          status: "PENDING",
          createdAt,
        })),
      });
      return {
        id: batchId,
        totalJobs: jobs.length,
        createdAt,
        jobs: jobs.map((job) => ({ id: job.id, productId: job.productId })),
      };
    });
  }

  async list(shopDomain: string): Promise<WatermarkBatchSummary[]> {
    const rows = await this.prisma.watermarkBatch.findMany({
      where: { shop: { domain: shopDomain } },
      include: { jobs: { select: { status: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return rows.map((row) => {
      const counts = {
        pendingJobs: 0,
        processingJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        cancelledJobs: 0,
      };
      for (const job of row.jobs) {
        if (job.status === "PENDING") counts.pendingJobs += 1;
        else if (job.status === "PROCESSING") counts.processingJobs += 1;
        else if (job.status === "COMPLETED") counts.completedJobs += 1;
        else if (job.status === "FAILED") counts.failedJobs += 1;
        else if (job.status === "CANCELLED") counts.cancelledJobs += 1;
      }
      return {
        id: row.id,
        totalJobs: row.totalJobs,
        ...counts,
        status: batchStatus(row.totalJobs, counts),
        createdAt: row.createdAt,
      };
    });
  }

  async cancel(batchId: string, shopDomain: string): Promise<void> {
    const batch = await this.prisma.watermarkBatch.findFirst({
      where: { id: batchId, shop: { domain: shopDomain } },
      select: { id: true },
    });
    if (!batch) throw new Error("Không tìm thấy watermark batch");
    await this.prisma.watermarkJob.updateMany({
      where: { batchId: batch.id, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  }
}

function batchStatus(
  totalJobs: number,
  counts: {
    pendingJobs: number;
    processingJobs: number;
    completedJobs: number;
    failedJobs: number;
    cancelledJobs: number;
  }
): WatermarkBatchStatus {
  if (counts.processingJobs > 0) return "RUNNING";
  if (counts.pendingJobs > 0) return "QUEUED";
  if (counts.completedJobs === totalJobs) return "COMPLETED";
  if (counts.cancelledJobs === totalJobs) return "CANCELLED";
  if (counts.failedJobs === totalJobs) return "FAILED";
  return "PARTIAL_FAILED";
}
