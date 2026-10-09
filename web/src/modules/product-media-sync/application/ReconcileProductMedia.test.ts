import { describe, expect, it, vi } from "vitest";
import type { ProductMediaState } from "../domain/ProductMediaChange.ts";
import {
  ReconcileProductMedia,
  type AutoWatermarkTrigger,
  type ProductMediaReconcileRepository,
} from "./ReconcileProductMedia.ts";

const product: ProductMediaState = {
  productId: "gid://shopify/Product/1",
  title: "Áo",
  status: "ACTIVE",
  productType: "Shirt",
  primaryMedia: {
    id: "gid://shopify/MediaImage/10",
    imageUrl: "https://cdn.shopify.com/a.jpg",
    altText: null,
    createdAt: null,
  },
  media: [],
};

function setup(sourceMediaId: string | null, publishedMediaIds: string[] = []) {
  const repository: ProductMediaReconcileRepository = {
    beginProcessing: vi.fn().mockResolvedValue({
      id: "inbox-1",
      webhookId: "wh-1",
      shopDomain: "shop.myshopify.com",
      productId: product.productId,
      triggeredAt: new Date(),
      claimedAt: new Date(),
    }),
    getTrackingState: vi.fn().mockResolvedValue({
      sourceMediaId,
      publishedMediaIds: new Set(publishedMediaIds),
      publishingMediaIds: new Set(),
      hasPublicationWithoutMediaId: false,
    }),
    applyChange: vi.fn().mockResolvedValue(undefined),
    defer: vi.fn(),
    markFailed: vi.fn(),
  };
  const autoWatermark: AutoWatermarkTrigger = { request: vi.fn().mockResolvedValue(undefined) };
  const reconcile = new ReconcileProductMedia(
    repository,
    { getProductMedia: vi.fn().mockResolvedValue(product) },
    autoWatermark,
  );
  return { reconcile, autoWatermark, repository };
}

describe("ReconcileProductMedia", () => {
  it("yêu cầu xét rule NEW_PRODUCT khi sản phẩm có ảnh chính lần đầu", async () => {
    const { reconcile, autoWatermark, repository } = setup(null);

    const change = await reconcile.execute("wh-1");

    expect(change?.kind).toBe("SOURCE_INITIALIZED");
    expect(repository.applyChange).toHaveBeenCalled();
    expect(autoWatermark.request).toHaveBeenCalledWith({
      shopDomain: "shop.myshopify.com",
      productId: product.productId,
      trigger: "NEW_PRODUCT",
    });
  });

  it("yêu cầu xét rule PRIMARY_CHANGED khi merchant đổi ảnh chính", async () => {
    const { reconcile, autoWatermark } = setup("gid://shopify/MediaImage/9");

    await reconcile.execute("wh-1");

    expect(autoWatermark.request).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "PRIMARY_CHANGED" }),
    );
  });

  it("không xét rule khi ảnh chính là ảnh watermark app vừa publish (chống vòng lặp)", async () => {
    const { reconcile, autoWatermark } = setup("gid://shopify/MediaImage/9", [
      "gid://shopify/MediaImage/10",
    ]);

    const change = await reconcile.execute("wh-1");

    expect(change?.kind).toBe("APP_MEDIA_PUBLISHED");
    expect(autoWatermark.request).not.toHaveBeenCalled();
  });
});
