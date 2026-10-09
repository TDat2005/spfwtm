import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { CatalogFilterReader } from "../application/BulkWatermarkPorts.ts";
import type {
  StudioProductReader,
  StudioProductSlice,
} from "../application/ListStudioProducts.ts";
import {
  isWatermarked,
  matchesCatalogFilter,
  type CatalogFilter,
  type FilterableProduct,
} from "../domain/CatalogFilter.ts";

const TITLE_ORDER = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });

interface CatalogRow {
  shopifyProductId: string;
  title: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  productType: string;
  imageUrl: string | null;
  imageAltText: string | null;
  needsReview: boolean;
  sourceVersion: number;
}

/**
 * Lọc bằng matchesCatalogFilter thay vì dịch sang SQL, để bảng sản phẩm
 * (listMatchingSlice) và "chọn tất cả khớp bộ lọc" (listMatchingProductIds)
 * dùng đúng một luật. Một shop vài chục nghìn sản phẩm vẫn lọc trong bộ nhớ được.
 */
export class PrismaCatalogFilterReader implements CatalogFilterReader, StudioProductReader {
  constructor(private readonly prisma: PrismaClient) {}

  async listMatchingProductIds(
    shopDomain: string,
    filter: CatalogFilter,
    collectionMemberIds: ReadonlySet<string> | null
  ): Promise<string[]> {
    const shopId = await this.findShopId(shopDomain);
    if (!shopId) return [];

    const needsPublished = filter.scope === "unwatermarked" || filter.scope === "watermarked";
    const [rows, publishedProductIds] = await Promise.all([
      // Thu hẹp sơ bộ bằng SQL; luật chính xác do matchesCatalogFilter quyết định.
      this.listRows(shopId, filter.productType),
      needsPublished ? this.listPublishedProductIds(shopId) : Promise.resolve(new Set<string>()),
    ]);
    const context = { publishedProductIds, collectionMemberIds };
    return rows
      .filter((row) => matchesCatalogFilter(toFilterable(row), filter, context))
      .map((row) => row.shopifyProductId);
  }

  async listMatchingSlice(
    shopDomain: string,
    filter: CatalogFilter,
    collectionMemberIds: ReadonlySet<string> | null,
    range: { offset: number; limit: number }
  ): Promise<StudioProductSlice> {
    const shopId = await this.findShopId(shopDomain);
    if (!shopId) {
      return { products: [], total: 0, reviewCount: 0, collectionCount: collectionMemberIds ? 0 : null };
    }

    // Không thu hẹp theo loại: reviewCount và collectionCount tính trên cả catalog.
    const [rows, publishedProductIds] = await Promise.all([
      this.listRows(shopId, null),
      this.listPublishedProductIds(shopId),
    ]);
    const context = { publishedProductIds, collectionMemberIds };
    const matching = rows.filter((row) => matchesCatalogFilter(toFilterable(row), filter, context));

    return {
      products: matching.slice(range.offset, range.offset + range.limit).map((row) => ({
        id: row.shopifyProductId,
        title: row.title,
        status: row.status,
        productType: row.productType,
        imageUrl: row.imageUrl!,
        imageAltText: row.imageAltText,
        needsReview: row.needsReview,
        sourceVersion: row.sourceVersion,
        isWatermarked: isWatermarked(toFilterable(row), publishedProductIds),
      })),
      total: matching.length,
      reviewCount: rows.filter((row) => row.needsReview).length,
      collectionCount: collectionMemberIds
        ? rows.filter((row) => collectionMemberIds.has(row.shopifyProductId)).length
        : null,
    };
  }

  private async findShopId(shopDomain: string): Promise<string | null> {
    const shop = await this.prisma.shop.findUnique({
      where: { domain: shopDomain },
      select: { id: true },
    });
    return shop?.id ?? null;
  }

  /**
   * Sản phẩm còn tồn tại và có ảnh, xếp theo tên (số trong tên so như số: "#2"
   * trước "#10"). Thứ tự cố định để trang không bị xáo khi sản phẩm được cập nhật.
   */
  private async listRows(shopId: string, productType: string | null): Promise<CatalogRow[]> {
    const rows = await this.prisma.catalogProduct.findMany({
      where: {
        shopId,
        deletedAt: null,
        imageUrl: { not: null },
        ...(productType !== null ? { productType } : {}),
      },
      select: {
        shopifyProductId: true,
        title: true,
        status: true,
        productType: true,
        imageUrl: true,
        imageAltText: true,
        needsReview: true,
        sourceVersion: true,
      },
    });
    return rows.sort(
      (a, b) =>
        TITLE_ORDER.compare(a.title, b.title) ||
        a.shopifyProductId.localeCompare(b.shopifyProductId)
    );
  }

  private async listPublishedProductIds(shopId: string): Promise<Set<string>> {
    const rows = await this.prisma.publishedMedia.findMany({
      where: { shopId },
      select: { shopifyProductId: true },
    });
    return new Set(rows.map((row) => row.shopifyProductId));
  }
}

function toFilterable(row: CatalogRow): FilterableProduct {
  return {
    id: row.shopifyProductId,
    title: row.title,
    productType: row.productType,
    imageUrl: row.imageUrl,
    needsReview: row.needsReview,
  };
}
