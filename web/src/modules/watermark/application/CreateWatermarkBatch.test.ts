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
  const useCase = new CreateWatermarkBatch(repository, { execute: dispatch });
  return { repository, dispatch, useCase };
}

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

  it("vẫn giới hạn 1.000 sản phẩm khi chọn tay", async () => {
    const { useCase } = setup();
    const productIds = Array.from({ length: 1_001 }, (_, i) => `p-${i}`);

    await expect(
      useCase.execute({ shopDomain: SHOP, selection: { kind: "PRODUCT_IDS", productIds }, layers }),
    ).rejects.toThrow("tối đa 1.000");
  });
});
