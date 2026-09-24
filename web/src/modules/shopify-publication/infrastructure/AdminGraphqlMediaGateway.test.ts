import type { Session } from "@shopify/shopify-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminGraphqlMediaGateway } from "./AdminGraphqlMediaGateway.ts";

describe("AdminGraphqlMediaGateway", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("upload và gắn ảnh trước khi application yêu cầu đưa lên vị trí đầu", async () => {
    const requests: Array<{
      query: string;
      variables?: Record<string, unknown>;
    }> = [];

    class FakeGraphqlClient {
      async request<T>(
        query: string,
        options?: { variables?: Record<string, unknown> }
      ): Promise<{ data?: T }> {
        requests.push({ query, variables: options?.variables });

        if (query.includes("stagedUploadsCreate")) {
          return {
            data: {
              stagedUploadsCreate: {
                stagedTargets: [
                  {
                    url: "https://upload.example.com",
                    resourceUrl: "https://cdn.example.com/staged-image",
                    parameters: [{ name: "key", value: "image-key" }],
                  },
                ],
                userErrors: [],
              },
            } as T,
          };
        }

        if (query.includes("productUpdate")) {
          return {
            data: {
              productUpdate: {
                product: {
                  id: "gid://shopify/Product/1",
                  media: {
                    nodes: [
                      {
                        id: "gid://shopify/MediaImage/99",
                        status: "UPLOADED",
                        image: null,
                      },
                    ],
                  },
                },
                userErrors: [],
              },
            } as T,
          };
        }

        if (query.includes("productReorderMedia")) {
          return {
            data: {
              productReorderMedia: {
                job: { id: "gid://shopify/Job/1" },
                mediaUserErrors: [],
              },
            } as T,
          };
        }

        throw new Error("Unexpected GraphQL operation");
      }
    }

    const shopify = {
      api: {
        clients: {
          Graphql: FakeGraphqlClient,
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 }))
    );

    const gateway = new AdminGraphqlMediaGateway(
      shopify,
      {} as Session
    );
    const result = await gateway.publish({
      productId: "gid://shopify/Product/1",
      bytes: Buffer.from("watermarked-image"),
      mimeType: "image/webp",
      filename: "watermark.webp",
      altText: "Watermarked product",
    });

    expect(result.mediaId).toBe("gid://shopify/MediaImage/99");
    expect(requests).toHaveLength(2);

    await gateway.promoteMedia(
      "gid://shopify/Product/1",
      "gid://shopify/MediaImage/99"
    );

    expect(requests).toHaveLength(3);
    expect(requests[2]?.query).toContain("productReorderMedia");
    expect(requests[2]?.variables).toEqual({
      id: "gid://shopify/Product/1",
      moves: [
        {
          id: "gid://shopify/MediaImage/99",
          newPosition: "0",
        },
      ],
    });
  });
});
