import { describe, expect, it, vi } from "vitest";
import { PublishWatermarkedImage } from "./PublishWatermarkedImage.ts";
import type { WatermarkResultReader } from "./WatermarkResultReader.ts";
import type { ShopifyMediaGateway } from "./ShopifyMediaGateway.ts";
import type { PublishedMediaRepository } from "./PublishedMediaRepository.ts";
import type { PublicationAttemptRepository } from "../../product-media-sync/application/PublicationAttemptRepository.ts";

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
});
