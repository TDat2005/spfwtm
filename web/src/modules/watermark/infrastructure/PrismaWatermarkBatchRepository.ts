import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type {
  BatchDispatchState,
  BatchSize,
  ClaimedBatchJob,
  CreatedWatermarkBatch,
  ResolvedBatchSelection,
  WatermarkBatchDispatchRepository,
  WatermarkBatchRepository,
  WatermarkBatchStatus,
  WatermarkBatchSummary,
} from "../application/BulkWatermarkPorts.ts";
import {
  INTERACTIVE_BATCH_LIMIT,
  batchSizeOf,
} from "../application/DispatchWatermarkBatch.ts";
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
    selection: ResolvedBatchSelection;
    maxJobs: number;
    design: WatermarkDesign;
  }): Promise<CreatedWatermarkBatch> {
    return this.prisma.$transaction(async (transaction) => {
      const shop = await transaction.shop.findUnique({
        where: { domain: input.shopDomain },
        select: { id: true },
      });
      if (!shop) throw new Error("Shop chưa đồng bộ catalog");

      const { targets, skippedProducts } = await selectTargets(
        transaction,
        shop.id,
        input.selection
      );
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

  async getDispatchState(batchId: string): Promise<BatchDispatchState | null> {
    const batch = await this.prisma.watermarkBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        shopId: true,
        totalJobs: true,
        shop: { select: { domain: true } },
      },
    });
    if (!batch) return null;

    const size = batchSizeOf(batch.totalJobs);
    const inFlightJobs = await this.prisma.watermarkJob.count({
      where: {
        shopId: batch.shopId,
        batch: { is: { totalJobs: totalJobsOf(size) } },
        OR: [
          { status: "PROCESSING" },
          { status: "PENDING", enqueuedAt: { not: null } },
        ],
      },
    });
    return {
      batchId: batch.id,
      shopId: batch.shopId,
      shopDomain: batch.shop.domain,
      size,
      inFlightJobs,
    };
  }

  async claimJobs(
    shopId: string,
    size: BatchSize,
    limit: number
  ): Promise<ClaimedBatchJob[]> {
    const batches = await this.prisma.watermarkBatch.findMany({
      where: { shopId, totalJobs: totalJobsOf(size), jobs: { some: UNDISPATCHED } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true },
    });

    const claimed: ClaimedBatchJob[] = [];
    for (const batch of batches) {
      const remaining = limit - claimed.length;
      if (remaining <= 0) break;
      const jobs = await this.prisma.watermarkJob.findMany({
        where: { batchId: batch.id, ...UNDISPATCHED },
        orderBy: { id: "asc" },
        take: remaining,
        select: { id: true },
      });
      claimed.push(...jobs.map((job) => ({ id: job.id, batchId: batch.id })));
    }
    if (claimed.length === 0) return [];

    await this.prisma.watermarkJob.updateMany({
      where: { id: { in: claimed.map((job) => job.id) }, ...UNDISPATCHED },
      data: { enqueuedAt: new Date() },
    });
    return claimed;
  }

  async releaseJobs(jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    await this.prisma.watermarkJob.updateMany({
      where: { id: { in: jobIds }, status: "PENDING" },
      data: { enqueuedAt: null },
    });
  }

  async listBatchesNeedingDispatch(
    afterBatchId: string | null,
    limit: number
  ): Promise<string[]> {
    const rows = await this.prisma.watermarkJob.groupBy({
      by: ["batchId"],
      where: {
        batchId: afterBatchId === null ? { not: null } : { gt: afterBatchId },
        ...UNDISPATCHED,
      },
      orderBy: { batchId: "asc" },
      take: limit,
    });
    return rows.flatMap((row) => (row.batchId ? [row.batchId] : []));
  }
}

/** Job PENDING chưa được đưa vào queue. */
const UNDISPATCHED = { status: "PENDING", enqueuedAt: null } as const;

function totalJobsOf(size: BatchSize) {
  return size === "SMALL"
    ? { lte: INTERACTIVE_BATCH_LIMIT }
    : { gt: INTERACTIVE_BATCH_LIMIT };
}

function selectTargets(
  transaction: Transaction,
  shopId: string,
  selection: ResolvedBatchSelection
): Promise<{ targets: BatchTarget[]; skippedProducts: number }> {
  switch (selection.kind) {
    case "PRODUCT_IDS":
      return selectByIds(transaction, shopId, selection.productIds);
    case "PRODUCT_TYPE":
      return selectByType(transaction, shopId, selection.productType);
    case "COLLECTION":
      return selectExisting(
        transaction,
        shopId,
        selection.productIds,
        "Collection không có sản phẩm nào đã đồng bộ và có ảnh nguồn"
      );
    case "PRODUCT_LIST":
      return selectExisting(
        transaction,
        shopId,
        selection.productIds,
        "Các sản phẩm đã chọn không còn ảnh nguồn"
      );
  }
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

/**
 * Sản phẩm (GID) có trong catalog và có ảnh nguồn, giữ nguyên thứ tự truyền vào:
 * thành viên collection, hoặc danh sách đã lọc ở bước "chọn tất cả khớp bộ lọc".
 * Sản phẩm chưa đồng bộ, đã xóa hoặc không có ảnh được bỏ qua, giống chọn theo loại.
 */
async function selectExisting(
  transaction: Transaction,
  shopId: string,
  productIds: string[],
  emptyMessage: string
): Promise<{ targets: BatchTarget[]; skippedProducts: number }> {
  const byProductId = new Map<string, BatchTarget>();
  for (let i = 0; i < productIds.length; i += CREATE_CHUNK_SIZE) {
    const products = await transaction.catalogProduct.findMany({
      where: {
        shopId,
        shopifyProductId: { in: productIds.slice(i, i + CREATE_CHUNK_SIZE) },
        deletedAt: null,
        imageUrl: { not: null },
      },
      select: { id: true, shopifyProductId: true, imageUrl: true, originalImageUrl: true },
    });
    for (const product of products) {
      byProductId.set(product.shopifyProductId, {
        id: product.id,
        shopifyProductId: product.shopifyProductId,
        imageUrl: product.originalImageUrl ?? product.imageUrl!,
      });
    }
  }
  // Giữ thứ tự sản phẩm như danh sách truyền vào.
  const targets = productIds.flatMap((id) => byProductId.get(id) ?? []);
  if (targets.length === 0) {
    throw new Error(emptyMessage);
  }
  return { targets, skippedProducts: productIds.length - targets.length };
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
