import type { CatalogFilter } from "../../src/modules/watermark/domain/CatalogFilter.ts";

/** Một dòng của GET /api/watermarks/products (chỉ sản phẩm có ảnh). */
export interface StudioProductDto {
  id: string;
  title: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  productType: string;
  imageUrl: string;
  imageAltText: string | null;
  needsReview: boolean;
  sourceVersion: number;
  isWatermarked: boolean;
}

export interface StudioProductsResponse {
  products: StudioProductDto[];
  /** Số sản phẩm khớp bộ lọc, tính cả các trang khác. */
  total: number;
  page: number;
  pageSize: number;
  /** Sản phẩm có ảnh mới cần duyệt trong cả catalog. */
  reviewCount: number;
  /** Sản phẩm có ảnh thuộc collection đang lọc; null khi không lọc collection. */
  collectionCount: number | null;
}

export const NO_FILTER: CatalogFilter = {
  scope: "all",
  productType: null,
  collectionId: null,
  search: "",
};

export function studioProductsUrl(filter: CatalogFilter, page: number, pageSize: number): string {
  const params = new URLSearchParams({
    scope: filter.scope,
    search: filter.search,
    page: String(page),
    pageSize: String(pageSize),
  });
  // "" là "chưa phân loại", khác với không lọc theo loại (null).
  if (filter.productType !== null) params.set("productType", filter.productType);
  if (filter.collectionId !== null) params.set("collectionId", filter.collectionId);
  return `/api/watermarks/products?${params.toString()}`;
}
