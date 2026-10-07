import { describe, expect, it, vi } from "vitest";
import { PublishWatermarkedImage } from "./PublishWatermarkedImage.ts";
import type { WatermarkResultReader } from "./WatermarkResultReader.ts";
import type { ShopifyMediaGateway } from "./ShopifyMediaGateway.ts";
import type { PublishedMediaRepository } from "./PublishedMediaRepository.ts";
import type { PublicationAttemptRepository } from "../../product-media-sync/application/PublicationAttemptRepository.ts";
import { PublishedMedia } from "../domain/PublishedMedia.ts";

describe("PublishWatermarkedImage", () => {
  it("preserves original product altText when publishing to Shopify", async () => {
    const mockResultReader: WatermarkResultReader = {
      read: vi.fn().mockResolvedValue({
        productId: "gid://shopify/Product/123",
        bytes: Buffer.from("image-bytes"),
        mimeType: "image/webp",
        defaultAltText: "Ski Wax Premium 100g",
      }),
    };

    const mockPublish = vi.fn().mockResolvedValue({
      mediaId: "gid://shopify/MediaImage/999",
      imageUrl: "https://cdn.shopify.com/wm-123.webp",
    });

    const mockShopifyGateway: ShopifyMediaGateway = {
      publish: mockPublish,
      promoteMedia: vi.fn().mockResolvedValue(undefined),
      deleteMedia: vi.fn().mockResolvedValue(undefined),
    };

    const mockPublishedRepo: PublishedMediaRepository = {
      save: vi.fn().mockResolvedValue(undefined),
      findByJobId: vi.fn().mockResolvedValue(null),
      listByShop: vi.fn().mockResolvedValue([]),
      listByProduct: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const mockAttemptsRepo: PublicationAttemptRepository = {
      start: vi.fn().mockResolvedValue(undefined),
      recordMedia: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
    };

    const useCase = new PublishWatermarkedImage(
      mockResultReader,
      mockShopifyGateway,
      mockPublishedRepo,
      mockAttemptsRepo,
    );

    // Call without explicit altText -> should use defaultAltText from original product
    await useCase.execute({
      watermarkJobId: "job-1",
      shopDomain: "test.myshopify.com",
    });

    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "gid://shopify/Product/123",
        altText: "Ski Wax Premium 100g",
      }),
    );
  });

  it("uses provided altText if specified by user", async () => {
    const mockResultReader: WatermarkResultReader = {
      read: vi.fn().mockResolvedValue({
        productId: "gid://shopify/Product/123",
        bytes: Buffer.from("image-bytes"),
        mimeType: "image/webp",
        defaultAltText: "Old Alt Text",
      }),
    };

    const mockPublish = vi.fn().mockResolvedValue({
      mediaId: "gid://shopify/MediaImage/999",
      imageUrl: "https://cdn.shopify.com/wm-123.webp",
    });

    const mockShopifyGateway: ShopifyMediaGateway = {
      publish: mockPublish,
      promoteMedia: vi.fn().mockResolvedValue(undefined),
      deleteMedia: vi.fn().mockResolvedValue(undefined),
    };

    const mockPublishedRepo: PublishedMediaRepository = {
      save: vi.fn().mockResolvedValue(undefined),
      findByJobId: vi.fn().mockResolvedValue(null),
      listByShop: vi.fn().mockResolvedValue([]),
      listByProduct: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const mockAttemptsRepo: PublicationAttemptRepository = {
      start: vi.fn().mockResolvedValue(undefined),
      recordMedia: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
    };

    const useCase = new PublishWatermarkedImage(
      mockResultReader,
      mockShopifyGateway,
      mockPublishedRepo,
      mockAttemptsRepo,
    );

    await useCase.execute({
      watermarkJobId: "job-1",
      shopDomain: "test.myshopify.com",
      altText: "Custom SEO Alt Text",
    });

    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        altText: "Custom SEO Alt Text",
      }),
    );
  });

  it("replacePrevious: đặt ảnh mới làm ảnh chính rồi mới xóa ảnh watermark cũ của app", async () => {
    const calls: string[] = [];
    const old = new PublishedMedia({
      id: "pm-old",
      shopDomain: "test.myshopify.com",
      watermarkJobId: "job-old",
      productId: "gid://shopify/Product/123",
      shopifyMediaId: "gid://shopify/MediaImage/111",
      imageUrl: null,
    });
    const gateway: ShopifyMediaGateway = {
      publish: vi.fn().mockResolvedValue({ mediaId: "gid://shopify/MediaImage/999", imageUrl: null }),
      promoteMedia: vi.fn(async () => {
        calls.push("promote");
      }),
      deleteMedia: vi.fn(async (_product: string, ids: string[]) => {
        calls.push(`delete:${ids.join(",")}`);
      }),
    };
    const repository: PublishedMediaRepository = {
      save: vi.fn().mockResolvedValue(undefined),
      findByJobId: vi.fn().mockResolvedValue(null),
      listByShop: vi.fn().mockResolvedValue([]),
      // Ảnh vừa publish cũng nằm trong danh sách: use case phải tự loại nó ra.
      listByProduct: vi.fn(async () => [old, ...savedMedia]),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const savedMedia: PublishedMedia[] = [];
    vi.mocked(repository.save).mockImplementation(async (media) => {
      savedMedia.push(media);
    });

    const published = await new PublishWatermarkedImage(
      {
        read: vi.fn().mockResolvedValue({
          productId: "gid://shopify/Product/123",
          bytes: Buffer.from("x"),
          mimeType: "image/webp",
          defaultAltText: null,
        }),
      },
      gateway,
      repository,
      {
        start: vi.fn().mockResolvedValue(undefined),
        recordMedia: vi.fn().mockResolvedValue(undefined),
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
      },
    ).execute({ watermarkJobId: "job-1", shopDomain: "test.myshopify.com", replacePrevious: true });

    expect(calls).toEqual(["promote", "delete:gid://shopify/MediaImage/111"]);
    expect(repository.delete).toHaveBeenCalledWith("pm-old");
    expect(repository.delete).not.toHaveBeenCalledWith(published.id);
  });

  it("không xóa gì khi không bật replacePrevious", async () => {
    const gateway: ShopifyMediaGateway = {
      publish: vi.fn().mockResolvedValue({ mediaId: "gid://shopify/MediaImage/999", imageUrl: null }),
      promoteMedia: vi.fn().mockResolvedValue(undefined),
      deleteMedia: vi.fn().mockResolvedValue(undefined),
    };
    await new PublishWatermarkedImage(
      {
        read: vi.fn().mockResolvedValue({
          productId: "gid://shopify/Product/123",
          bytes: Buffer.from("x"),
          mimeType: "image/webp",
          defaultAltText: null,
        }),
      },
      gateway,
      {
        save: vi.fn().mockResolvedValue(undefined),
        findByJobId: vi.fn().mockResolvedValue(null),
        listByShop: vi.fn().mockResolvedValue([]),
        listByProduct: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      {
        start: vi.fn().mockResolvedValue(undefined),
        recordMedia: vi.fn().mockResolvedValue(undefined),
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
      },
    ).execute({ watermarkJobId: "job-1", shopDomain: "test.myshopify.com" });

    expect(gateway.deleteMedia).not.toHaveBeenCalled();
  });
});
