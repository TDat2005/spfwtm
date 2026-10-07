import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type {
  AutoWatermarkJobWriter,
  AutoWatermarkRuleRepository,
  ProductAutoStateReader,
} from "../application/AutoWatermarkPorts.ts";
import type { ProductAutoState } from "../domain/AutoWatermarkDecision.ts";
import { AutoWatermarkRule } from "../domain/AutoWatermarkRule.ts";

const CHUNK_SIZE = 1_000;

type RuleRow = Awaited<ReturnType<PrismaClient["autoWatermarkRule"]["findMany"]>>[number] & {
  shop: { domain: string };
};

const PRODUCT_SELECT = {
  id: true,
  shopifyProductId: true,
  productType: true,
  sourceVersion: true,
  imageUrl: true,
  originalImageUrl: true,
  autoRuleId: true,
  autoDesignId: true,
  autoSourceVersion: true,
} as const;

type ProductRow = {
  id: string;
  shopifyProductId: string;
  productType: string;
  sourceVersion: number;
  imageUrl: string | null;
  originalImageUrl: string | null;
  autoRuleId: string | null;
  autoDesignId: string | null;
  autoSourceVersion: number | null;
};

export class PrismaAutoWatermarkRepository
  implements AutoWatermarkRuleRepository, ProductAutoStateReader, AutoWatermarkJobWriter
{
  constructor(private readonly prisma: PrismaClient) {}

  // --- Rules ---

  async listByShop(shopDomain: string): Promise<AutoWatermarkRule[]> {
    const rows = await this.prisma.autoWatermarkRule.findMany({
      where: { shop: { domain: shopDomain } },
      include: { shop: { select: { domain: true } } },
    });
    return rows.map(toRule);
  }

  async findById(id: string, shopDomain: string): Promise<AutoWatermarkRule | null> {
    const row = await this.prisma.autoWatermarkRule.findFirst({
      where: { id, shop: { domain: shopDomain } },
      include: { shop: { select: { domain: true } } },
    });
    return row ? toRule(row) : null;
  }

  async save(rule: AutoWatermarkRule): Promise<void> {
    const shop = await this.requireShop(rule.shopDomain);
    const data = {
      name: rule.name,
      enabled: rule.enabled,
      priority: rule.priority,
      scope: rule.scope,
      scopeValue: rule.scopeValue,
      scopeLabel: rule.scopeLabel,
      designId: rule.designId,
      onNewProduct: rule.onNewProduct,
      onPrimaryChanged: rule.onPrimaryChanged,
      syncScope: rule.syncScope,
      autoPublish: rule.autoPublish,
      restoreOnLeave: rule.restoreOnLeave,
      lastAppliedAt: rule.lastAppliedAt,
    };
    await this.prisma.autoWatermarkRule.upsert({
      where: { id: rule.id },
      create: { id: rule.id, shopId: shop.id, createdAt: rule.createdAt, ...data },
      update: data,
    });
  }

  async delete(id: string, shopDomain: string): Promise<void> {
    await this.prisma.autoWatermarkRule.deleteMany({
      where: { id, shop: { domain: shopDomain } },
    });
  }

  async markApplied(ruleIds: string[], at: Date): Promise<void> {
    if (ruleIds.length === 0) return;
    await this.prisma.autoWatermarkRule.updateMany({
      where: { id: { in: ruleIds } },
      data: { lastAppliedAt: at },
    });
  }

  async listShopsWithSyncRules(): Promise<string[]> {
    const shops = await this.prisma.shop.findMany({
      where: {
        uninstalledAt: null,
        autoWatermarkRules: {
          some: { enabled: true, OR: [{ syncScope: true }, { restoreOnLeave: true }] },
        },
      },
      select: { domain: true },
    });
    return shops.map((shop) => shop.domain);
  }

  // --- Product state ---

  async findProduct(shopDomain: string, shopifyProductId: string): Promise<ProductAutoState | null> {
    const row = await this.prisma.catalogProduct.findFirst({
      where: { shopifyProductId, deletedAt: null, shop: { domain: shopDomain } },
      select: { ...PRODUCT_SELECT, shopId: true },
    });
    if (!row) return null;
    const published = await this.prisma.publishedMedia.findMany({
      where: { shopId: row.shopId, shopifyProductId },
      select: PUBLISHED_SELECT,
    });
    return toProductState(row, groupPublished(published).get(shopifyProductId));
  }

  async listProducts(shopDomain: string): Promise<ProductAutoState[]> {
    const shop = await this.prisma.shop.findUnique({
      where: { domain: shopDomain },
      select: { id: true },
    });
    if (!shop) return [];
    const [rows, published] = await Promise.all([
      this.prisma.catalogProduct.findMany({
        where: { shopId: shop.id, deletedAt: null },
        select: PRODUCT_SELECT,
      }),
      this.prisma.publishedMedia.findMany({
        where: { shopId: shop.id },
        select: PUBLISHED_SELECT,
      }),
    ]);
    const byProduct = groupPublished(published);
    return rows.map((row) => toProductState(row, byProduct.get(row.shopifyProductId)));
  }

  // --- Jobs ---

  async createJobs(input: {
    rule: AutoWatermarkRule;
    products: ProductAutoState[];
    asBatch: boolean;
  }): Promise<{ batchId: string | null; jobIds: string[] }> {
    const products = input.products.filter((product) => product.sourceImageUrl);
    if (products.length === 0) return { batchId: null, jobIds: [] };
    const shop = await this.requireShop(input.rule.shopDomain);
    const productIds = products.map((product) => product.catalogProductId);

    return this.prisma.$transaction(
      async (transaction) => {
        // Ảnh nguồn mới thay cho ảnh cũ: job auto cũ còn chờ thì không cần nữa.
        for (const ids of chunks(productIds)) {
          await transaction.watermarkJob.updateMany({
            where: { catalogProductId: { in: ids }, ruleId: { not: null }, status: "PENDING" },
            data: { status: "CANCELLED" },
          });
        }

        const batchId = input.asBatch ? randomUUID() : null;
        if (batchId) {
          await transaction.watermarkBatch.create({
            data: {
              id: batchId,
              shopId: shop.id,
              designId: input.rule.designId,
              totalJobs: products.length,
            },
          });
        }

        const jobs = products.map((product) => ({
          id: randomUUID(),
          shopId: shop.id,
          catalogProductId: product.catalogProductId,
          batchId,
          sourceImageUrl: product.sourceImageUrl!,
          designId: input.rule.designId,
          ruleId: input.rule.id,
          publishOnComplete: input.rule.autoPublish,
          status: "PENDING" as const,
        }));
        for (const chunk of chunks(jobs)) {
          await transaction.watermarkJob.createMany({ data: chunk });
        }

        // Ghi trạng thái theo đúng phiên bản ảnh đã đọc: nếu merchant vừa đổi
        // ảnh (sourceVersion tăng) thì không đánh dấu, để lần xét sau tạo job mới.
        const byVersion = new Map<number, string[]>();
        for (const product of products) {
          const ids = byVersion.get(product.sourceVersion) ?? [];
          ids.push(product.catalogProductId);
          byVersion.set(product.sourceVersion, ids);
        }
        for (const [sourceVersion, ids] of byVersion) {
          for (const chunk of chunks(ids)) {
            await transaction.catalogProduct.updateMany({
              where: { id: { in: chunk }, sourceVersion },
              data: {
                autoRuleId: input.rule.id,
                autoDesignId: input.rule.designId,
                autoSourceVersion: sourceVersion,
              },
            });
          }
        }

        return { batchId, jobIds: jobs.map((job) => job.id) };
      },
      { timeout: 60_000 },
    );
  }

  async clearAutoState(catalogProductIds: string[], ruleId: string): Promise<void> {
    for (const ids of chunks(catalogProductIds)) {
      await this.prisma.catalogProduct.updateMany({
        where: { id: { in: ids }, autoRuleId: ruleId },
        data: { autoRuleId: null, autoDesignId: null, autoSourceVersion: null },
      });
    }
  }

  private async requireShop(shopDomain: string): Promise<{ id: string }> {
    const shop = await this.prisma.shop.findUnique({
      where: { domain: shopDomain },
      select: { id: true },
    });
    if (!shop) throw new Error("Shop chưa đồng bộ catalog");
    return shop;
  }
}

function toRule(row: RuleRow): AutoWatermarkRule {
  return new AutoWatermarkRule({
    id: row.id,
    shopDomain: row.shop.domain,
    name: row.name,
    enabled: row.enabled,
    priority: row.priority,
    scope: row.scope,
    scopeValue: row.scopeValue,
    scopeLabel: row.scopeLabel,
    designId: row.designId,
    onNewProduct: row.onNewProduct,
    onPrimaryChanged: row.onPrimaryChanged,
    syncScope: row.syncScope,
    autoPublish: row.autoPublish,
    restoreOnLeave: row.restoreOnLeave,
    lastAppliedAt: row.lastAppliedAt,
    createdAt: row.createdAt,
  });
}

const PUBLISHED_SELECT = {
  shopifyProductId: true,
  watermarkJobId: true,
  watermarkJob: { select: { ruleId: true } },
} as const;

interface PublishedRow {
  shopifyProductId: string;
  watermarkJobId: string;
  watermarkJob: { ruleId: string | null };
}

interface ProductPublications {
  hasManualWatermark: boolean;
  publishedByRules: Array<{ ruleId: string; watermarkJobId: string }>;
}

/** Ảnh watermark đang có trên Shopify theo sản phẩm: làm tay hay do rule nào. */
function groupPublished(rows: PublishedRow[]): Map<string, ProductPublications> {
  const result = new Map<string, ProductPublications>();
  for (const row of rows) {
    const entry = result.get(row.shopifyProductId) ?? { hasManualWatermark: false, publishedByRules: [] };
    if (row.watermarkJob.ruleId) {
      entry.publishedByRules.push({ ruleId: row.watermarkJob.ruleId, watermarkJobId: row.watermarkJobId });
    } else {
      entry.hasManualWatermark = true;
    }
    result.set(row.shopifyProductId, entry);
  }
  return result;
}

function toProductState(row: ProductRow, published: ProductPublications | undefined): ProductAutoState {
  return {
    catalogProductId: row.id,
    shopifyProductId: row.shopifyProductId,
    productType: row.productType,
    sourceVersion: row.sourceVersion,
    sourceImageUrl: row.originalImageUrl ?? row.imageUrl,
    lastAuto:
      row.autoRuleId && row.autoDesignId && row.autoSourceVersion !== null
        ? {
            ruleId: row.autoRuleId,
            designId: row.autoDesignId,
            sourceVersion: row.autoSourceVersion,
          }
        : null,
    hasManualWatermark: published?.hasManualWatermark ?? false,
    publishedByRules: published?.publishedByRules ?? [],
  };
}

function chunks<T>(items: T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    result.push(items.slice(i, i + CHUNK_SIZE));
  }
  return result;
}
