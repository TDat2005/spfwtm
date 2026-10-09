import { describe, expect, it, vi } from "vitest";
import type { CatalogFilter } from "../domain/CatalogFilter.ts";
import { CachedCollectionProductLookup } from "../infrastructure/CachedCollectionProductLookup.ts";
import { ListStudioProducts, MAX_STUDIO_PRODUCTS_PAGE_SIZE } from "./ListStudioProducts.ts";

const SHOP = "a.myshopify.com";
const COLLECTION = "gid://shopify/Collection/42";
const filter: CatalogFilter = { scope: "all", productType: null, collectionId: null, search: "" };

function setup(collection: string[] | null = ["p-1"]) {
  const reader = {
    listMatchingSlice: vi.fn(async () => ({
      products: [],
      total: 120,
      reviewCount: 3,
      collectionCount: null,
    })),
  };
  const collections = { listProductIds: vi.fn(async () => collection) };
  return { useCase: new ListStudioProducts(reader, collections), reader, collections };
}

describe("ListStudioProducts", () => {
  it("đổi số trang thành đoạn offset/limit", async () => {
    const { useCase, reader } = setup();

    const page = await useCase.execute({ shopDomain: SHOP, filter, page: 3, pageSize: 50 });

    expect(reader.listMatchingSlice).toHaveBeenCalledWith(SHOP, filter, null, { offset: 100, limit: 50 });
    expect(page).toMatchObject({ page: 3, pageSize: 50, total: 120 });
  });

  it("lọc theo collection bằng thành viên lấy từ Shopify", async () => {
    const { useCase, reader } = setup(["p-1", "p-2"]);

    await useCase.execute({
      shopDomain: SHOP,
      filter: { ...filter, collectionId: COLLECTION },
      page: 1,
      pageSize: 50,
    });

    expect(reader.listMatchingSlice).toHaveBeenCalledWith(
      SHOP,
      expect.objectContaining({ collectionId: COLLECTION }),
      new Set(["p-1", "p-2"]),
      { offset: 0, limit: 50 },
    );
  });

  it("báo lỗi khi collection không còn trên Shopify", async () => {
    const { useCase } = setup(null);

    await expect(
      useCase.execute({
        shopDomain: SHOP,
        filter: { ...filter, collectionId: COLLECTION },
        page: 1,
        pageSize: 50,
      }),
    ).rejects.toThrow("Không tìm thấy collection");
  });

  it("từ chối trang hoặc cỡ trang không hợp lệ", async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ shopDomain: SHOP, filter, page: 0, pageSize: 50 })).rejects.toThrow();
    await expect(
      useCase.execute({ shopDomain: SHOP, filter, page: 1, pageSize: MAX_STUDIO_PRODUCTS_PAGE_SIZE + 1 }),
    ).rejects.toThrow();
  });
});

describe("CachedCollectionProductLookup", () => {
  it("dùng lại thành viên collection trong thời gian cache", async () => {
    let now = 0;
    const lookup = { listProductIds: vi.fn(async () => ["p-1"]) };
    const cached = new CachedCollectionProductLookup(lookup, 60_000, 10, () => now);

    await cached.listProductIds(SHOP, COLLECTION);
    now = 59_000;
    await cached.listProductIds(SHOP, COLLECTION);
    expect(lookup.listProductIds).toHaveBeenCalledTimes(1);

    now = 61_000;
    await cached.listProductIds(SHOP, COLLECTION);
    expect(lookup.listProductIds).toHaveBeenCalledTimes(2);
  });

  it("không giữ lại lượt hỏi Shopify bị lỗi", async () => {
    const lookup = {
      listProductIds: vi
        .fn<() => Promise<string[] | null>>()
        .mockRejectedValueOnce(new Error("Shopify 503"))
        .mockResolvedValueOnce(["p-1"]),
    };
    const cached = new CachedCollectionProductLookup(lookup);

    await expect(cached.listProductIds(SHOP, COLLECTION)).rejects.toThrow("Shopify 503");
    await expect(cached.listProductIds(SHOP, COLLECTION)).resolves.toEqual(["p-1"]);
  });
});
