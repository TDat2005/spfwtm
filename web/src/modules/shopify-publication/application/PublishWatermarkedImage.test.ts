import { describe, expect, it, vi } from "vitest";
import { PublishedMedia } from "../domain/PublishedMedia.ts";
import { PublishWatermarkedImage } from "./PublishWatermarkedImage.ts";
import type { PublishedMediaRepository } from "./PublishedMediaRepository.ts";
import type { ShopifyMediaGateway } from "./ShopifyMediaGateway.ts";
import type { WatermarkResultReader } from "./WatermarkResultReader.ts";
import type { PublicationAttemptRepository } from "../../product-media-sync/application/PublicationAttemptRepository.ts";

function attemptRepository(): PublicationAttemptRepository {
  return {
    start: vi.fn(async () => undefined),
    recordMedia: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  };
}

describe("PublishWatermarkedImage", () => {
  it("đưa media đã publish trước đó lên lại vị trí ảnh chính", async () => {
    const existing = new PublishedMedia({
      id: "published-1",
      shopDomain: "demo.myshopify.com",
      watermarkJobId: "watermark-1",
      productId: "gid://shopify/Product/1",
      shopifyMediaId: "gid://shopify/MediaImage/99",
      imageUrl: null,
    });
    const repository: PublishedMediaRepository = {
      save: vi.fn(async () => undefined),
      findByJobId: vi.fn(async () => existing),
      listByShop: vi.fn(async () => [existing]),
      delete: vi.fn(async () => undefined),
    };
    const resultReader: WatermarkResultReader = {
      read: vi.fn(async () => null),
    };
    const gateway: ShopifyMediaGateway = {
      publish: vi.fn(),
      promoteMedia: vi.fn(async () => undefined),
      deleteMedia: vi.fn(async () => undefined),
    };
    const useCase = new PublishWatermarkedImage(
      resultReader,
      gateway,
      repository,
      attemptRepository()
    );

    const result = await useCase.execute({
      watermarkJobId: "watermark-1",
      shopDomain: "demo.myshopify.com",
      altText: "Watermarked product",
    });

    expect(result).toBe(existing);
    expect(gateway.promoteMedia).toHaveBeenCalledWith(
      existing.productId,
      existing.shopifyMediaId
    );
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it("lưu media ID trước khi reorder để webhook không tạo vòng lặp", async () => {
    const order: string[] = [];
    const repository: PublishedMediaRepository = {
      save: vi.fn(async () => { order.push("published-media"); }),
      findByJobId: vi.fn(async () => null),
      listByShop: vi.fn(async () => []),
      delete: vi.fn(async () => undefined),
    };
    const resultReader: WatermarkResultReader = {
      read: vi.fn(async () => ({
        productId: "gid://shopify/Product/1",
        bytes: Buffer.from("image"),
        mimeType: "image/webp",
      })),
    };
    const gateway: ShopifyMediaGateway = {
      publish: vi.fn(async () => {
        order.push("upload");
        return { mediaId: "gid://shopify/MediaImage/99", imageUrl: null };
      }),
      promoteMedia: vi.fn(async () => { order.push("reorder"); }),
      deleteMedia: vi.fn(async () => undefined),
    };
    const attempts: PublicationAttemptRepository = {
      start: vi.fn(async () => { order.push("attempt-start"); }),
      recordMedia: vi.fn(async () => { order.push("attempt-media"); }),
      complete: vi.fn(async () => { order.push("attempt-complete"); }),
      fail: vi.fn(async () => undefined),
    };
    const useCase = new PublishWatermarkedImage(
      resultReader,
      gateway,
      repository,
      attempts
    );

    await useCase.execute({
      watermarkJobId: "watermark-1",
      shopDomain: "demo.myshopify.com",
      altText: "Watermarked product",
    });

    expect(order).toEqual([
      "attempt-start",
      "upload",
      "attempt-media",
      "published-media",
      "reorder",
      "attempt-complete",
    ]);
  });
});
