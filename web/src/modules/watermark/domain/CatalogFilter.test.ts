import { describe, expect, it } from "vitest";
import {
  matchesCatalogFilter,
  parseCatalogFilter,
  type CatalogFilter,
  type FilterableProduct,
} from "./CatalogFilter.ts";

const ALL: CatalogFilter = { scope: "all", productType: null, collectionId: null, search: "" };
const context = { publishedProductIds: new Set(["p-published"]), collectionMemberIds: null };

function product(overrides: Partial<FilterableProduct> = {}): FilterableProduct {
  return {
    id: "p-1",
    title: "Sản phẩm thử #12",
    productType: "Seed 1",
    imageUrl: "https://cdn.shopify.com/a.jpg",
    needsReview: false,
    ...overrides,
  };
}

describe("matchesCatalogFilter", () => {
  it("chỉ nhận sản phẩm có ảnh", () => {
    expect(matchesCatalogFilter(product(), ALL, context)).toBe(true);
    expect(matchesCatalogFilter(product({ imageUrl: null }), ALL, context)).toBe(false);
  });

  it("lọc theo trạng thái watermark (đã publish hoặc ảnh /wm-)", () => {
    const unwatermarked = { ...ALL, scope: "unwatermarked" as const };
    const watermarked = { ...ALL, scope: "watermarked" as const };
    expect(matchesCatalogFilter(product(), unwatermarked, context)).toBe(true);
    expect(matchesCatalogFilter(product({ id: "p-published" }), unwatermarked, context)).toBe(false);
    expect(matchesCatalogFilter(product({ imageUrl: "https://x/wm-1.webp" }), watermarked, context)).toBe(true);
  });

  it("lọc theo loại đúng tuyệt đối, kể cả nhóm chưa phân loại", () => {
    expect(matchesCatalogFilter(product(), { ...ALL, productType: "Seed 1" }, context)).toBe(true);
    expect(matchesCatalogFilter(product(), { ...ALL, productType: "seed 1" }, context)).toBe(false);
    expect(matchesCatalogFilter(product({ productType: "" }), { ...ALL, productType: "" }, context)).toBe(true);
  });

  it("lọc theo collection: chưa tải xong thành viên thì không khớp gì", () => {
    const filter = { ...ALL, collectionId: "gid://shopify/Collection/1" };
    expect(matchesCatalogFilter(product(), filter, context)).toBe(false);
    expect(
      matchesCatalogFilter(product(), filter, { ...context, collectionMemberIds: new Set(["p-1"]) }),
    ).toBe(true);
  });

  it("tìm theo tên không phân biệt hoa thường", () => {
    expect(matchesCatalogFilter(product(), { ...ALL, search: "  SẢN PHẨM thử " }, context)).toBe(true);
    expect(matchesCatalogFilter(product(), { ...ALL, search: "áo" }, context)).toBe(false);
  });
});

describe("parseCatalogFilter", () => {
  it("điền mặc định và kiểm tra giá trị", () => {
    expect(parseCatalogFilter({})).toEqual(ALL);
    expect(() => parseCatalogFilter({ scope: "lạ" })).toThrow("Phạm vi lọc");
    expect(() => parseCatalogFilter({ collectionId: "123" })).toThrow("Collection");
    expect(() => parseCatalogFilter(null)).toThrow("Bộ lọc");
  });
});
