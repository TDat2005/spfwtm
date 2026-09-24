import { describe, expect, it, vi } from "vitest";
import type { ProductMediaState } from "../domain/ProductMediaChange.ts";
import type {
  ProductMediaGateway,
  ProductMediaReconcileRepository,
  ProductMediaTrackingState,
  WebhookInboxItem,
} from "./ReconcileProductMedia.ts";
import { ReconcileProductMedia } from "./ReconcileProductMedia.ts";

describe("ReconcileProductMedia", () => {
  it("webhook đến sai thứ tự vẫn dùng trạng thái Shopify mới nhất", async () => {
    const inbox: WebhookInboxItem = {
      id: "inbox-old",
      webhookId: "webhook-old",
      shopDomain: "shop-a.myshopify.com",
      productId: "gid://shopify/Product/1",
      triggeredAt: new Date("2026-09-24T03:00:00.000Z"),
    };
    const latest = productState("new-primary");
    const applyChange = vi.fn(async () => undefined);
    const repository = fakeRepository(inbox, {
      sourceMediaId: "old-primary",
      publishedMediaIds: new Set(),
      publishingMediaIds: new Set(),
      hasPublicationWithoutMediaId: false,
    }, applyChange);
    const gateway: ProductMediaGateway = {
      getProductMedia: vi.fn(async () => latest),
    };

    const result = await new ReconcileProductMedia(
      repository,
      gateway
    ).execute("webhook-old");

    expect(result?.kind).toBe("MERCHANT_PRIMARY_CHANGED");
    expect(applyChange).toHaveBeenCalledWith(
      expect.objectContaining({ product: latest })
    );
  });

  it("ảnh app đã lưu không tạo thay đổi nguồn mới", async () => {
    const inbox: WebhookInboxItem = {
      id: "inbox-app",
      webhookId: "webhook-app",
      shopDomain: "shop-a.myshopify.com",
      productId: "gid://shopify/Product/1",
      triggeredAt: new Date(),
    };
    const applyChange = vi.fn(async () => undefined);
    const repository = fakeRepository(inbox, {
      sourceMediaId: "merchant-source",
      publishedMediaIds: new Set(["app-media"]),
      publishingMediaIds: new Set(),
      hasPublicationWithoutMediaId: false,
    }, applyChange);
    const gateway: ProductMediaGateway = {
      getProductMedia: vi.fn(async () => productState("app-media")),
    };

    const result = await new ReconcileProductMedia(
      repository,
      gateway
    ).execute("webhook-app");

    expect(result?.kind).toBe("APP_MEDIA_PUBLISHED");
    expect(applyChange).toHaveBeenCalledOnce();
  });
});

function fakeRepository(
  inbox: WebhookInboxItem,
  tracking: ProductMediaTrackingState,
  applyChange: ProductMediaReconcileRepository["applyChange"]
): ProductMediaReconcileRepository {
  return {
    beginProcessing: vi.fn(async () => inbox),
    getTrackingState: vi.fn(async () => tracking),
    applyChange,
    defer: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
  };
}

function productState(primaryId: string): ProductMediaState {
  const primary = {
    id: primaryId,
    imageUrl: `https://cdn.example.com/${primaryId}.jpg`,
    altText: null,
    createdAt: new Date("2026-09-24T03:00:00.000Z"),
  };
  return {
    productId: "gid://shopify/Product/1",
    title: "Latest product state",
    status: "ACTIVE",
    primaryMedia: primary,
    media: [primary],
  };
}
