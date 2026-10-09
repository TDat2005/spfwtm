import { describe, expect, it, vi } from "vitest";
import type { CatalogFilter } from "../domain/CatalogFilter.ts";
import type { CreatedWatermarkBatch, ResolvedBatchSelection } from "./BulkWatermarkPorts.ts";
import {
  CreateFilteredWatermarkBatches,
  FILTER_BATCH_SIZE,
  MAX_FILTER_JOBS,
} from "./CreateFilteredWatermarkBatches.ts";

const SHOP = "a.myshopify.com";
const layers = [{ type: "TEXT" as const, text: "SALE", position: "CENTER" as const, opacity: 0.5 }];
const filter: CatalogFilter = { scope: "all", productType: "Seed 1", collectionId: null, search: "" };

function setup(matching: string[], collection: string[] | null = []) {
  let created = 0;
  const repository = {
    create: vi.fn(async (input: { selection: ResolvedBatchSelection }): Promise<CreatedWatermarkBatch> => {
      created += 1;
      const ids = input.selection.kind === "PRODUCT_LIST" ? input.selection.productIds : [];
      return {
        id: `batch-${created}`,
        totalJobs: ids.length,
        skippedProducts: 0,
        createdAt: new Date(),
        jobs: [],
      };
    }),
    list: vi.fn(),
    cancel: vi.fn(),
  };
  const dispatcher = { execute: vi.fn(async (_batchId: string) => 0) };
  const collections = { listProductIds: vi.fn(async () => collection) };
  const catalog = { listMatchingProductIds: vi.fn(async () => matching) };
  const useCase = new CreateFilteredWatermarkBatches(repository, dispatcher, collections, catalog);
  return { useCase, repository, dispatcher, collections, catalog };
}

const ids = (count: number) => Array.from({ length: count }, (_, i) => `p-${i}`);

describe("CreateFilteredWatermarkBatches", () => {
  it("một lần bấm tạo batch cho mọi sản phẩm khớp bộ lọc", async () => {
    const { useCase, repository, dispatcher } = setup(ids(4_604));

    const batches = await useCase.execute({ shopDomain: SHOP, filter, layers });

    expect(batches).toHaveLength(1);
    expect(batches[0]?.totalJobs).toBe(4_604);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ maxJobs: FILTER_BATCH_SIZE }),
    );
    expect(dispatcher.execute).toHaveBeenCalledWith("batch-1");
  });

  it("chia thành nhiều batch khi khớp hơn 5.000 sản phẩm", async () => {
    const { useCase, dispatcher } = setup(ids(12_000));

    const batches = await useCase.execute({ shopDomain: SHOP, filter, layers });

    expect(batches.map((batch) => batch.totalJobs)).toEqual([5_000, 5_000, 2_000]);
    expect(dispatcher.execute.mock.calls.map(([id]) => id)).toEqual(["batch-1", "batch-2", "batch-3"]);
  });

  it("lấy thành viên collection từ Shopify khi lọc theo collection", async () => {
    const { useCase, catalog } = setup(ids(3), ["p-0", "p-1", "p-2"]);
    const collectionId = "gid://shopify/Collection/42";

    await useCase.execute({ shopDomain: SHOP, filter: { ...filter, collectionId }, layers });

    expect(catalog.listMatchingProductIds).toHaveBeenCalledWith(
      SHOP,
      expect.objectContaining({ collectionId }),
      new Set(["p-0", "p-1", "p-2"]),
    );
  });

  it("báo lỗi rõ khi không có sản phẩm nào khớp hoặc khớp quá nhiều", async () => {
    await expect(setup([]).useCase.execute({ shopDomain: SHOP, filter, layers })).rejects.toThrow(
      "Không có sản phẩm nào khớp bộ lọc",
    );
    await expect(
      setup(ids(MAX_FILTER_JOBS + 1)).useCase.execute({ shopDomain: SHOP, filter, layers }),
    ).rejects.toThrow("Hãy lọc theo loại hoặc collection");
  });

  it("kiểm tra design trước khi đọc catalog", async () => {
    const { useCase, catalog } = setup(ids(1));

    await expect(useCase.execute({ shopDomain: SHOP, filter, layers: [] })).rejects.toThrow();
    expect(catalog.listMatchingProductIds).not.toHaveBeenCalled();
  });
});
