import type { CollectionProductLookup } from "../application/BulkWatermarkPorts.ts";

interface Entry {
  expiresAt: number;
  productIds: Promise<string[] | null>;
}

/**
 * Lật trang hay đổi từ khóa khi đang lọc theo collection không cần hỏi lại
 * Shopify (collection lớn tốn nhiều request) mỗi lần. Tạo batch vẫn dùng bản
 * không cache để lấy đúng thành viên tại lúc bấm.
 */
export class CachedCollectionProductLookup implements CollectionProductLookup {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly lookup: CollectionProductLookup,
    private readonly ttlMs = 60_000,
    private readonly maxEntries = 200,
    private readonly now: () => number = Date.now,
  ) {}

  listProductIds(shopDomain: string, collectionId: string): Promise<string[] | null> {
    const key = `${shopDomain}|${collectionId}`;
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.productIds;

    // Giữ promise để các request đồng thời dùng chung một lượt hỏi Shopify.
    const productIds = this.lookup.listProductIds(shopDomain, collectionId);
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { expiresAt: this.now() + this.ttlMs, productIds });
    productIds.catch(() => {
      if (this.entries.get(key)?.productIds === productIds) this.entries.delete(key);
    });
    return productIds;
  }
}
