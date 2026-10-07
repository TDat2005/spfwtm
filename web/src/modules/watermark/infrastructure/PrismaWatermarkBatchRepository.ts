import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type {
  BatchDispatchState,
  CreatedBatchJob,
  CreatedWatermarkBatch,
  WatermarkBatchDispatchRepository,
  WatermarkBatchRepository,
  WatermarkBatchSelection,
  WatermarkBatchStatus,
  WatermarkBatchSummary,
} from "../application/BulkWatermarkPorts.ts";
import type { WatermarkDesign } from "../domain/WatermarkDesign.ts";
import { saveWatermarkDesign } from "./PrismaWatermarkDesigns.ts";

const CREATE_CHUNK_SIZE = 1_000;

type Transaction = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

interface BatchTarget {
  id: string;
  shopifyProductId: string;
  imageUrl: string;
}

export class PrismaWatermarkBatchRepository
  implements WatermarkBatchRepository, WatermarkBatchDispatchRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: {
    shopDomain: string;
    selection: WatermarkBatchSelection;
    maxJobs: number;
    design: WatermarkDesign;
  }): Promise<CreatedWatermarkBatch> {
    return this.prisma.$transaction(async (transaction) => {
      const shop = await transaction.shop.findUnique({
        where: { domain: input.shopDomain },
        select: { id: true },
      });
      if (!shop) throw new Error("Shop chưa đồng bộ catalog");

      const { targets, skippedProducts } =
        input.selection.kind === "PRODUCT_IDS"
          ? await selectByIds(transaction, shop.id, input.selection.productIds)
          : await selectByType(transaction, shop.id, input.selection.productType);
      if (targets.length > input.maxJobs) {
        throw new Error(
          `Batch có ${targets.length.toLocaleString("vi-VN")} sản phẩm, vượt giới hạn ${input.maxJobs.toLocaleString("vi-VN")}`
        );
      }

      const designId = await saveWatermarkDesign(transaction, shop.id, input.design);
      const batchId = randomUUID();
      const createdAt = new Date();
      const jobs = targets.map((product) => ({
        id: randomUUID(),
        productId: product.shopifyProductId,
        catalogProductId: product.id,
        sourceImageUrl: product.imageUrl,
      }));

      await transaction.watermarkBatch.create({
        data: {
          id: batchId,
          shopId: shop.id,
          designId,
          totalJobs: jobs.length,
          createdAt,
        },
      });
      for (let i = 0; i < jobs.length; i += CREATE_CHUNK_SIZE) {
        await transaction.watermarkJob.createMany({
          data: jobs.slice(i, i + CREATE_CHUNK_SIZE).map((job) => ({
            id: job.id,
            shopId: shop.id,
            catalogProductId: job.catalogProductId,
            batchId,
            sourceImageUrl: job.sourceImageUrl,
            designId,
            status: "PENDING",
            createdAt,
          })),
        });
      }
      return {
        id: batchId,
        totalJobs: jobs.length,
        skippedProducts,
        createdAt,
        jobs: jobs.map((job) => ({ id: job.id, productId: job.productId })),
      };
    }, {
      timeout: 30_000,
    });
  }

  async list(shopDomain: string): Promise<WatermarkBatchSummary[]> {
    const rows = await this.prisma.watermarkBatch.findMany({
      where: { shop: { domain: shopDomain } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const statusCounts = await this.prisma.watermarkJob.groupBy({
      by: ["batchId", "status"],
      where: { batchId: { in: rows.map((row) => row.id) } },
      _count: { _all: true },
    });

    return rows.map((row) => {
      const counts = {
        pendingJobs: 0,
        processingJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        cancelledJobs: 0,
      };
      for (const group of statusCounts) {
        if (group.batchId !== row.id) continue;
        const count = group._count._all;
        if (group.status === "PENDING") counts.pendingJobs += count;
        else if (group.status === "PROCESSING") counts.processingJobs += count;
        else if (group.status === "COMPLETED") counts.completedJobs += count;
        else if (group.status === "FAILED") counts.failedJobs += count;
        else if (group.status === "CANCELLED") counts.cancelledJobs += count;
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

  async getDispatchState(
    batchId: string,
    staleBefore: Date
  ): Promise<BatchDispatchState | null> {
    const batch = await this.prisma.watermarkBatch.findUnique({
      where: { id: batchId },
      select: { id: true, totalJobs: true, shop: { select: { domain: true } } },
    });
    if (!batch) return null;

    const inFlightJobs = await this.prisma.watermarkJob.count({
      where: {
        batchId,
        OR: [
          { status: "PROCESSING" },
          { status: "PENDING", enqueuedAt: { gte: staleBefore } },
        ],
      },
    });
    return {
      batchId: batch.id,
      shopDomain: batch.shop.domain,
      totalJobs: batch.totalJobs,
      inFlightJobs,
    };
  }

  async claimJobs(
    batchId: string,
    limit: number,
    staleBefore: Date
  ): Promise<CreatedBatchJob[]> {
    const candidates = await this.prisma.watermarkJob.findMany({
      where: { batchId, ...undispatchedPending(staleBefore) },
      orderBy: { id: "asc" },
      take: limit,
      select: { id: true, product: { select: { shopifyProductId: true } } },
    });
    if (candidates.length === 0) return [];

    await this.prisma.watermarkJob.updateMany({
      where: { id: { in: candidates.map((job) => job.id) }, status: "PENDING" },
      data: { enqueuedAt: new Date() },
    });
    return candidates.map((job) => ({
      id: job.id,
      productId: job.product.shopifyProductId,
    }));
  }

  async releaseJobs(jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    await this.prisma.watermarkJob.updateMany({
      where: { id: { in: jobIds }, status: "PENDING" },
      data: { enqueuedAt: null },
    });
  }

  async listBatchesNeedingDispatch(
    staleBefore: Date,
    limit: number
  ): Promise<string[]> {
    const rows = await this.prisma.watermarkJob.findMany({
      where: { batchId: { not: null }, ...undispatchedPending(staleBefore) },
      distinct: ["batchId"],
      select: { batchId: true },
      take: limit,
    });
    return rows.flatMap((row) => (row.batchId ? [row.batchId] : []));
  }
}

function undispatchedPending(staleBefore: Date) {
  return {
    status: "PENDING" as const,
    OR: [{ enqueuedAt: null }, { enqueuedAt: { lt: staleBefore } }],
  };
}

async function selectByIds(
  transaction: Transaction,
  shopId: string,
  productIds: string[]
): Promise<{ targets: BatchTarget[]; skippedProducts: number }> {
  const products = await transaction.catalogProduct.findMany({
    where: {
      shopId,
      shopifyProductId: { in: productIds },
      deletedAt: null,
    },
    select: { id: true, shopifyProductId: true, imageUrl: true, originalImageUrl: true },
  });
  const byProductId = new Map(
    products.map((product) => [product.shopifyProductId, product])
  );
  const unavailable = productIds.filter(
    (id) => !(byProductId.get(id)?.originalImageUrl || byProductId.get(id)?.imageUrl)
  );
  if (unavailable.length > 0) {
    throw new Error(
      `${unavailable.length} sản phẩm chưa đồng bộ hoặc không có ảnh nguồn`
    );
  }

  return {
    targets: productIds.map((id) => {
      const product = byProductId.get(id)!;
      return {
        ...product,
        imageUrl: product.originalImageUrl ?? product.imageUrl!,
      };
    }),
    skippedProducts: 0,
  };
}

async function selectByType(
  transaction: Transaction,
  shopId: string,
  productType: string
): Promise<{ targets: BatchTarget[]; skippedProducts: number }> {
  const where = { shopId, productType, deletedAt: null };
  const [targets, totalProducts] = await Promise.all([
    transaction.catalogProduct.findMany({
      where: { ...where, imageUrl: { not: null } },
      select: { id: true, shopifyProductId: true, imageUrl: true, originalImageUrl: true },
      orderBy: { shopifyProductId: "asc" },
    }),
    transaction.catalogProduct.count({ where }),
  ]);

  const label = productType || "Chưa phân loại";
  if (totalProducts === 0) {
    throw new Error(`Không có sản phẩm nào thuộc loại "${label}"`);
  }
  if (targets.length === 0) {
    throw new Error(`Không có sản phẩm nào thuộc loại "${label}" có ảnh nguồn`);
  }

  return {
    targets: targets.map((product) => ({
      ...product,
      imageUrl: product.originalImageUrl ?? product.imageUrl!,
    })),
    skippedProducts: totalProducts - targets.length,
  };
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
