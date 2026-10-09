export interface CollectionSummary {
  id: string;
  title: string;
  productsCount: number | null;
}

/**
 * Collection của một shop, gọi Shopify Admin API bằng offline session.
 * Catalog không lưu thành viên collection (Shopify không có webhook báo sản
 * phẩm vào/ra collection), nên luôn hỏi trực tiếp Shopify.
 */
export interface ShopCollections {
  isInCollection(productId: string, collectionId: string): Promise<boolean>;
  /** GID sản phẩm trong collection; null = collection không còn tồn tại. */
  listProductIds(collectionId: string): Promise<string[] | null>;
  getCollectionTitle(collectionId: string): Promise<string | null>;
  search(query: string): Promise<CollectionSummary[]>;
}

export interface ShopCollectionsFactory {
  forShop(shopDomain: string): Promise<ShopCollections>;
}

export function isCollectionGid(value: string): boolean {
  return /^gid:\/\/shopify\/Collection\/\d+$/.test(value);
}
