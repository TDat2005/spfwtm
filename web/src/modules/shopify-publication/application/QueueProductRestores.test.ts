import { describe, expect, it, vi } from "vitest";
import type { EnqueueJobInput } from "../../jobs/application/EnqueueJob.ts";
import { PUBLICATION_RESTORE_PRODUCT_V1 } from "../../jobs/domain/JobDefinitions.ts";
import type { CatalogFilter } from "../../watermark/domain/CatalogFilter.ts";
import {
  MAX_SELECTED_RESTORE,
  QueueProductRestores,
  restoreProductJob,
} from "./QueueProductRestores.ts";

const SHOP = "a.myshopify.com";
const P1 = "gid://shopify/Product/1";
const P2 = "gid://shopify/Product/2";
const P3 = "gid://shopify/Product/3";
const filter: CatalogFilter = { scope: "watermarked", productType: null, collectionId: null, search: "" };

function setup(restorable: string[], matching: string[] = []) {
  const queued: EnqueueJobInput[] = [];
  const queue = { executeMany: vi.fn(async (inputs: EnqueueJobInput[]) => void queued.push(...inputs)) };
  const matchingIds = { execute: vi.fn(async () => matching) };
  const useCase = new QueueProductRestores(
    { listRestorableProductIds: async () => new Set(restorable) },
    matchingIds,
    queue,
  );
  return { useCase, queue, queued, matchingIds };
}

describe("QueueProductRestores", () => {
  it("chỉ đưa vào queue sản phẩm đang có ảnh watermark của app", async () => {
    const { useCase, queued } = setup([P1, P3]);

    const result = await useCase.execute(SHOP, { kind: "PRODUCT_IDS", productIds: [P1, P2, P3, P1] });

    expect(result).toEqual({ queuedCount: 2, skippedCount: 1 });
    expect(queued.map((job) => job.payload.productId)).toEqual([P1, P3]);
    expect(queued[0]).toMatchObject({
      jobName: PUBLICATION_RESTORE_PRODUCT_V1.jobName,
      payload: { productId: P1, shopDomain: SHOP },
      replaceFinished: true,
    });
  });

  it("chọn tất cả khớp bộ lọc: lấy sản phẩm theo bộ lọc của studio", async () => {
    const { useCase, queued, matchingIds } = setup([P1, P2], [P1, P2, P3]);

    const result = await useCase.execute(SHOP, { kind: "FILTER", filter });

    expect(matchingIds.execute).toHaveBeenCalledWith(SHOP, filter);
    expect(result).toEqual({ queuedCount: 2, skippedCount: 1 });
    expect(queued).toHaveLength(2);
  });

  it("khôi phục tất cả: đưa mọi sản phẩm đang có watermark vào queue", async () => {
    const { useCase, queued, matchingIds } = setup([P1, P2]);

    const result = await useCase.executeAll(SHOP);

    expect(result).toEqual({ queuedCount: 2, skippedCount: 0 });
    expect(queued.map((job) => job.payload.productId).sort()).toEqual([P1, P2]);
    expect(matchingIds.execute).not.toHaveBeenCalled();
  });

  it("không gọi queue khi không có gì để khôi phục", async () => {
    const { useCase, queue } = setup([]);

    const result = await useCase.execute(SHOP, { kind: "PRODUCT_IDS", productIds: [P1] });

    expect(result).toEqual({ queuedCount: 0, skippedCount: 1 });
    expect(queue.executeMany).not.toHaveBeenCalled();
  });

  it("từ chối khi chưa chọn gì hoặc chọn tay quá giới hạn", async () => {
    const { useCase } = setup([P1]);
    const tooMany = Array.from({ length: MAX_SELECTED_RESTORE + 1 }, (_, i) => `gid://shopify/Product/${i}`);

    await expect(useCase.execute(SHOP, { kind: "PRODUCT_IDS", productIds: [] })).rejects.toThrow();
    await expect(useCase.execute(SHOP, { kind: "PRODUCT_IDS", productIds: tooMany })).rejects.toThrow();
  });

  it("jobId cố định theo sản phẩm và không chứa dấu hai chấm", () => {
    const first = restoreProductJob(P1, SHOP).jobId;

    expect(first).toBe(restoreProductJob(P1, SHOP).jobId);
    expect(first).not.toBe(restoreProductJob(P2, SHOP).jobId);
    expect(first).not.toContain(":");
  });
});
