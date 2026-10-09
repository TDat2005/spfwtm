import type { CatalogFilter } from "../domain/CatalogFilter.ts";
import type { CollectionProductLookup } from "./BulkWatermarkPorts.ts";

export const STUDIO_PRODUCTS_PAGE_SIZE = 50;
export const MAX_STUDIO_PRODUCTS_PAGE_SIZE = 100;

/** Một dòng trong bảng sản phẩm của studio (chỉ sản phẩm có ảnh). */
export interface StudioProduct {
  id: string;
  title: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  productType: string;
  imageUrl: string;
  imageAltText: string | null;
  needsReview: boolean;
  sourceVersion: number;
  /** Đang có ảnh watermark của app trên Shopify (cùng luật bộ lọc "watermarked"). */
  isWatermarked: boolean;
}

export interface StudioProductSlice {
  products: StudioProduct[];
  /** Số sản phẩm khớp bộ lọc, tính cả các trang khác. */
  total: number;
  /** Sản phẩm có ảnh mới cần duyệt trong cả catalog, không phụ thuộc bộ lọc. */
  reviewCount: number;
  /** Sản phẩm có ảnh thuộc collection đang lọc; null khi không lọc collection. */
  collectionCount: number | null;
}

export interface StudioProductPage extends StudioProductSlice {
  page: number;
  pageSize: number;
}

export interface StudioProductReader {
  /**
   * Một đoạn của danh sách sản phẩm khớp bộ lọc, cùng luật và thứ tự với
   * CatalogFilterReader.listMatchingProductIds ("chọn tất cả khớp bộ lọc").
   */
  listMatchingSlice(
    shopDomain: string,
    filter: CatalogFilter,
    collectionMemberIds: ReadonlySet<string> | null,
    range: { offset: number; limit: number }
  ): Promise<StudioProductSlice>;
}

export interface ListStudioProductsInput {
  shopDomain: string;
  filter: CatalogFilter;
  page: number;
  pageSize: number;
}

/** Bảng sản phẩm của studio, phân trang ở server thay vì tải cả catalog về trình duyệt. */
export class ListStudioProducts {
  constructor(
    private readonly products: StudioProductReader,
    private readonly collections: CollectionProductLookup,
  ) {}

  async execute(input: ListStudioProductsInput): Promise<StudioProductPage> {
    if (!input.shopDomain.trim()) throw new Error("Shop domain không được để trống");
    if (!Number.isInteger(input.page) || input.page < 1) {
      throw new Error("Số trang phải là số nguyên dương");
    }
    if (
      !Number.isInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > MAX_STUDIO_PRODUCTS_PAGE_SIZE
    ) {
      throw new Error(`Mỗi trang từ 1 đến ${MAX_STUDIO_PRODUCTS_PAGE_SIZE} sản phẩm`);
    }

    let collectionMembers: ReadonlySet<string> | null = null;
    if (input.filter.collectionId !== null) {
      const ids = await this.collections.listProductIds(input.shopDomain, input.filter.collectionId);
      if (ids === null) throw new Error("Không tìm thấy collection trên Shopify");
      collectionMembers = new Set(ids);
    }

    const slice = await this.products.listMatchingSlice(
      input.shopDomain,
      input.filter,
      collectionMembers,
      { offset: (input.page - 1) * input.pageSize, limit: input.pageSize },
    );
    return { ...slice, page: input.page, pageSize: input.pageSize };
  }
}
