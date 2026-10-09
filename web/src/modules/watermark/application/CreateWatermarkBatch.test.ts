import { describe, expect, it, vi } from "vitest";
import type { CreatedWatermarkBatch, WatermarkBatchRepository } from "./BulkWatermarkPorts.ts";
import { CreateWatermarkBatch } from "./CreateWatermarkBatch.ts";

const SHOP = "test.myshopify.com";
const layers = [{ type: "TEXT" as const, text: "SALE", position: "CENTER" as const, opacity: 0.5 }];

function setup(jobCount = 2) {
  const batch: CreatedWatermarkBatch = {
    id: "batch-1",
    totalJobs: jobCount,
    skippedProducts: 0,
    createdAt: new Date(),
    jobs: Array.from({ length: jobCount }, (_, i) => ({ id: `job-${i}`, productId: `p-${i}` })),
  };
  const repository: WatermarkBatchRepository = {
    create: vi.fn().mockResolvedValue(batch),
    list: vi.fn(),
    cancel: vi.fn(),
  };
  const dispatch = vi.fn().mockResolvedValue(0);
  const collections = {
    listProductIds: vi.fn<(shopDomain: string, collectionId: string) => Promise<string[] | null>>(),
  };
  const useCase = new CreateWatermarkBatch(repository, { execute: dispatch }, collections);
  return { repository, dispatch, collections, useCase };
}

const COLLECTION = "gid://shopify/Collection/42";

describe("CreateWatermarkBatch", () => {
  it("tạo batch theo loại sản phẩm với giới hạn lớn hơn chọn tay", async () => {
    const { repository, useCase } = setup();

    await useCase.execute({
      shopDomain: SHOP,
      selection: { kind: "PRODUCT_TYPE", productType: "  Áo thun " },
      layers,
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { kind: "PRODUCT_TYPE", productType: "Áo thun" },
        maxJobs: 5_000,
      }),
    );
  });

  it("cho phép chọn nhóm sản phẩm chưa phân loại", async () => {
    const { repository, useCase } = setup();

    await useCase.execute({
      shopDomain: SHOP,
      selection: { kind: "PRODUCT_TYPE", productType: "" },
      layers,
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ selection: { kind: "PRODUCT_TYPE", productType: "" } }),
    );
  });

  it("giao việc đưa job vào queue cho dispatcher thay vì đẩy cả batch một lần", async () => {
    const { dispatch, useCase } = setup(2_500);

    await useCase.execute({
      shopDomain: SHOP,
      selection: { kind: "PRODUCT_TYPE", productType: "Giày" },
      layers,
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith("batch-1");
  });

  it("tạo batch theo collection từ danh sách sản phẩm lấy trên Shopify", async () => {
    const { repository, collections, useCase } = setup();
    collections.listProductIds.mockResolvedValue(["gid://shopify/Product/1", "gid://shopify/Product/2"]);

    await useCase.execute({
      shopDomain: SHOP,
      selection: { kind: "COLLECTION", collectionId: ` ${COLLECTION} ` },
      layers,
    });

    expect(collections.listProductIds).toHaveBeenCalledWith(SHOP, COLLECTION);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: {
          kind: "COLLECTION",
          collectionId: COLLECTION,
          productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"],
        },
        maxJobs: 5_000,
      }),
    );
  });

  it("báo lỗi khi collection không còn trên Shopify hoặc chưa có sản phẩm", async () => {
    const { repository, collections, useCase } = setup();
    const selection = { kind: "COLLECTION" as const, collectionId: COLLECTION };

    collections.listProductIds.mockResolvedValueOnce(null);
    await expect(useCase.execute({ shopDomain: SHOP, selection, layers })).rejects.toThrow(
      "Không tìm thấy collection",
    );
    collections.listProductIds.mockResolvedValueOnce([]);
    await expect(useCase.execute({ shopDomain: SHOP, selection, layers })).rejects.toThrow(
      "chưa có sản phẩm",
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("không gọi Shopify khi collection ID không hợp lệ", async () => {
    const { collections, useCase } = setup();

    await expect(
      useCase.execute({
        shopDomain: SHOP,
        selection: { kind: "COLLECTION", collectionId: "gid://shopify/Product/1" },
        layers,
      }),
    ).rejects.toThrow("Collection không hợp lệ");
    expect(collections.listProductIds).not.toHaveBeenCalled();
  });

  it("vẫn giới hạn 1.000 sản phẩm khi chọn tay", async () => {
    const { useCase } = setup();
    const productIds = Array.from({ length: 1_001 }, (_, i) => `p-${i}`);

    await expect(
      useCase.execute({ shopDomain: SHOP, selection: { kind: "PRODUCT_IDS", productIds }, layers }),
    ).rejects.toThrow("tối đa 1.000");
  });
});
