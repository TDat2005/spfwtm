import { describe, expect, it, vi } from "vitest";
import { PrismaWebhookInboxRepository } from "./PrismaWebhookInboxRepository.ts";

describe("PrismaWebhookInboxRepository tenant boundary", () => {
  it("mọi lookup media đều scope theo shop domain dù product ID giống nhau", async () => {
    const catalogFind = vi.fn(async () => ({ sourceMediaId: "source-a" }));
    const publishedFind = vi.fn(async () => []);
    const attemptFind = vi.fn(async () => []);
    const prisma = {
      catalogProduct: { findFirst: catalogFind },
      publishedMedia: { findMany: publishedFind },
      publicationAttempt: { findMany: attemptFind },
    };
    const repository = new PrismaWebhookInboxRepository(prisma as never);

    await repository.getTrackingState(
      "shop-a.myshopify.com",
      "gid://shopify/Product/1"
    );

    for (const mock of [catalogFind, publishedFind, attemptFind]) {
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            shop: { domain: "shop-a.myshopify.com" },
          }),
        })
      );
    }
  });
});
