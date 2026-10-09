import type { CatalogFilter } from "../domain/CatalogFilter.ts";
import type { CatalogFilterReader, CollectionProductLookup } from "./BulkWatermarkPorts.ts";

/**
 * GID mọi sản phẩm khớp bộ lọc của studio, cho các thao tác "tất cả sản phẩm
 * khớp bộ lọc" ngoài tạo batch (ví dụ khôi phục ảnh gốc hàng loạt).
 */
export class ListMatchingProductIds {
  constructor(
    private readonly catalog: CatalogFilterReader,
    private readonly collections: CollectionProductLookup,
  ) {}

  async execute(shopDomain: string, filter: CatalogFilter): Promise<string[]> {
    if (!shopDomain.trim()) throw new Error("Shop domain không được để trống");
    let collectionMembers: ReadonlySet<string> | null = null;
    if (filter.collectionId !== null) {
      const ids = await this.collections.listProductIds(shopDomain, filter.collectionId);
      if (ids === null) throw new Error("Không tìm thấy collection trên Shopify");
      collectionMembers = new Set(ids);
    }
    return this.catalog.listMatchingProductIds(shopDomain, filter, collectionMembers);
  }
}
