import type { Session } from "@shopify/shopify-api";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { AdminGraphqlMediaGateway } from "./AdminGraphqlMediaGateway.ts";
import { AdminGraphqlProductMediaReader } from "./AdminGraphqlProductMediaReader.ts";
import { PrismaAppMediaRegistry } from "./PrismaAppMediaRegistry.ts";

type ShopifyContext = ConstructorParameters<typeof AdminGraphqlMediaGateway>[0];

const session = { shop: "test.myshopify.com" } as Session;
const PRODUCT = "gid://shopify/Product/1";

function shopifyWith(request: (query: string, options?: { variables?: Record<string, unknown> }) => unknown) {
  const spy = vi.fn(async (query: string, options?: { variables?: Record<string, unknown> }) => ({
    data: await request(query, options),
  }));
  class FakeGraphql {
    request = spy;
  }
  const shopify = { api: { clients: { Graphql: FakeGraphql } } } as unknown as ShopifyContext;
  return { shopify, spy };
}

describe("AdminGraphqlMediaGateway.deleteMedia", () => {
  it("ném lỗi tiếng Việt khi Shopify trả mediaUserErrors", async () => {
    const { shopify } = shopifyWith(() => ({
      productDeleteMedia: {
        deletedMediaIds: [],
        mediaUserErrors: [{ field: ["mediaIds"], message: "Media id gid://shopify/MediaImage/9 does not exist" }],
      },
    }));

    await expect(
      new AdminGraphqlMediaGateway(shopify, session).deleteMedia(PRODUCT, ["gid://shopify/MediaImage/9"]),
    ).rejects.toThrow(/Shopify không xóa được ảnh.*mediaIds: Media id gid:\/\/shopify\/MediaImage\/9 does not exist/);
  });

  it("không ném lỗi khi xóa thành công và không gọi Shopify khi danh sách rỗng", async () => {
    const { shopify, spy } = shopifyWith(() => ({
      productDeleteMedia: { deletedMediaIds: ["gid://shopify/MediaImage/9"], mediaUserErrors: [] },
    }));
    const gateway = new AdminGraphqlMediaGateway(shopify, session);

    await gateway.deleteMedia(PRODUCT, []);
    expect(spy).not.toHaveBeenCalled();

    await expect(gateway.deleteMedia(PRODUCT, ["gid://shopify/MediaImage/9"])).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("AdminGraphqlProductMediaReader", () => {
  it("đọc hết mọi trang media để không coi media ở trang sau là đã biến mất", async () => {
    const { shopify, spy } = shopifyWith((_query, options) => {
      const after = options?.variables?.after;
      return after
        ? {
            product: {
              media: {
                nodes: [{ id: "m3", image: { url: "u3" } }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          }
        : {
            product: {
              media: {
                nodes: [{ id: "m1", image: { url: "u1" } }, { id: "m2", image: null }],
                pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
              },
            },
          };
    });

    const media = await new AdminGraphqlProductMediaReader(shopify, session).listMedia(PRODUCT);

    expect(media).toEqual([
      { id: "m1", imageUrl: "u1" },
      { id: "m2", imageUrl: null },
      { id: "m3", imageUrl: "u3" },
    ]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("ném lỗi khi sản phẩm không tồn tại trên Shopify", async () => {
    const { shopify } = shopifyWith(() => ({ product: null }));
    const reader = new AdminGraphqlProductMediaReader(shopify, session);

    await expect(reader.listMedia(PRODUCT)).rejects.toThrow("Không tìm thấy sản phẩm");
    await expect(reader.readPrimaryImage(PRODUCT)).rejects.toThrow("Không tìm thấy sản phẩm");
  });

  it("readPrimaryImage trả null khi sản phẩm không còn ảnh", async () => {
    const { shopify } = shopifyWith(() => ({ product: { media: { nodes: [] } } }));

    await expect(new AdminGraphqlProductMediaReader(shopify, session).readPrimaryImage(PRODUCT)).resolves.toBeNull();
  });
});

describe("PrismaAppMediaRegistry", () => {
  function prismaStub() {
    const publishedFindMany = vi.fn().mockResolvedValue([
      { shopifyMediaId: "pm-1" },
      { shopifyMediaId: "shared" },
    ]);
    const attemptFindMany = vi.fn().mockResolvedValue([
      { shopifyMediaId: "attempt-1" },
      { shopifyMediaId: "shared" },
      { shopifyMediaId: null },
    ]);
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      publishedMedia: { findMany: publishedFindMany, deleteMany },
      publicationAttempt: { findMany: attemptFindMany },
    } as unknown as PrismaClient;
    return { prisma, publishedFindMany, attemptFindMany, deleteMany };
  }

  it("gộp id từ PublishedMedia và PublicationAttempt, chỉ theo đúng shop và sản phẩm", async () => {
    const { prisma, publishedFindMany, attemptFindMany } = prismaStub();

    const ids = await new PrismaAppMediaRegistry(prisma).listAppMediaIds(session.shop, PRODUCT);

    expect(ids.sort()).toEqual(["attempt-1", "pm-1", "shared"]);
    expect(publishedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shopifyProductId: PRODUCT, shop: { domain: session.shop } },
      }),
    );
    expect(attemptFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          productId: PRODUCT,
          shopifyMediaId: { not: null },
          shop: { domain: session.shop },
        },
      }),
    );
  });

  it("chỉ xóa PublishedMedia của đúng các media được quên", async () => {
    const { prisma, deleteMany } = prismaStub();
    const registry = new PrismaAppMediaRegistry(prisma);

    await registry.forgetPublishedMedia(session.shop, PRODUCT, []);
    expect(deleteMany).not.toHaveBeenCalled();

    await registry.forgetPublishedMedia(session.shop, PRODUCT, ["pm-1"]);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        shopifyProductId: PRODUCT,
        shopifyMediaId: { in: ["pm-1"] },
        shop: { domain: session.shop },
      },
    });
  });
});
