/**
 * Bộ lọc danh sách sản phẩm trong studio. Server dùng cùng một luật cho bảng
 * sản phẩm phân trang và cho batch "chọn tất cả sản phẩm khớp bộ lọc", nên số
 * sản phẩm UI hiển thị và số job server tạo luôn khớp nhau. UI dùng chung kiểu
 * dữ liệu của file này để gửi bộ lọc.
 */
export const CATALOG_SCOPES = ["all", "review", "unwatermarked", "watermarked"] as const;
export type CatalogScope = (typeof CATALOG_SCOPES)[number];

export interface CatalogFilter {
  scope: CatalogScope;
  /** null = mọi loại; "" = sản phẩm chưa phân loại. */
  productType: string | null;
  /** GID collection; null = không lọc theo collection. */
  collectionId: string | null;
  search: string;
}

export interface FilterableProduct {
  id: string;
  title: string;
  productType: string;
  imageUrl: string | null;
  needsReview: boolean;
}

export interface CatalogFilterContext {
  /** Sản phẩm đang có ảnh watermark của app trên Shopify. */
  publishedProductIds: ReadonlySet<string>;
  /** Thành viên collection đang lọc; null khi chưa tải xong hoặc không lọc collection. */
  collectionMemberIds: ReadonlySet<string> | null;
}

const MAX_SEARCH_LENGTH = 255;
const COLLECTION_GID = /^gid:\/\/shopify\/Collection\/\d+$/;

export function isWatermarked(
  product: Pick<FilterableProduct, "id" | "imageUrl">,
  publishedProductIds: ReadonlySet<string>,
): boolean {
  return publishedProductIds.has(product.id) || Boolean(product.imageUrl?.includes("/wm-"));
}

export function matchesCatalogFilter(
  product: FilterableProduct,
  filter: CatalogFilter,
  context: CatalogFilterContext,
): boolean {
  if (!product.imageUrl) return false;
  if (filter.scope === "review" && !product.needsReview) return false;
  if (filter.scope === "unwatermarked" && isWatermarked(product, context.publishedProductIds)) {
    return false;
  }
  if (filter.scope === "watermarked" && !isWatermarked(product, context.publishedProductIds)) {
    return false;
  }
  if (filter.productType !== null && product.productType !== filter.productType) return false;
  // Đang tải thành viên collection thì chưa khớp gì, tránh chọn nhầm sản phẩm ngoài collection.
  if (filter.collectionId !== null && context.collectionMemberIds?.has(product.id) !== true) {
    return false;
  }
  const search = normalizeSearch(filter.search);
  return !search || product.title.toLocaleLowerCase("vi").includes(search);
}

/** Kiểm tra bộ lọc nhận từ request; lỗi thì ném Error với thông điệp cho merchant. */
export function parseCatalogFilter(raw: unknown): CatalogFilter {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Bộ lọc sản phẩm không hợp lệ");
  }
  const value = raw as Record<string, unknown>;
  const scope = value.scope ?? "all";
  if (typeof scope !== "string" || !(CATALOG_SCOPES as readonly string[]).includes(scope)) {
    throw new Error("Phạm vi lọc sản phẩm không hợp lệ");
  }
  const productType = value.productType ?? null;
  if (productType !== null && typeof productType !== "string") {
    throw new Error("Loại sản phẩm phải là chuỗi");
  }
  const collectionId = value.collectionId ?? null;
  if (collectionId !== null && (typeof collectionId !== "string" || !COLLECTION_GID.test(collectionId))) {
    throw new Error("Collection không hợp lệ");
  }
  const search = value.search ?? "";
  if (typeof search !== "string" || search.length > MAX_SEARCH_LENGTH) {
    throw new Error("Từ khóa tìm kiếm không hợp lệ");
  }
  return { scope: scope as CatalogScope, productType, collectionId, search };
}

function normalizeSearch(search: string): string {
  return search.trim().toLocaleLowerCase("vi");
}
