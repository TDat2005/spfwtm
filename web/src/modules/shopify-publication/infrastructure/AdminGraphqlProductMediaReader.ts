import type { Session } from "@shopify/shopify-api";
import type {
  ProductMediaReader,
  ProductMediaSnapshot,
} from "../application/RestoreProductOriginal.ts";

interface ShopifyGraphqlClient {
  request<T>(
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<{ data?: T }>;
}

interface ShopifyApiContext {
  api: {
    clients: {
      Graphql: new (options: { session: Session }) => ShopifyGraphqlClient;
    };
  };
}

interface MediaNode {
  id: string;
  image?: { url: string } | null;
}

interface ProductMediaPageResponse {
  product: {
    media: {
      nodes: MediaNode[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}

interface ProductPrimaryResponse {
  product: { media: { nodes: MediaNode[] } } | null;
}

// Shopify giới hạn 250 media mỗi sản phẩm; giới hạn trang chỉ để tránh vòng lặp vô hạn.
const PAGE_SIZE = 250;
const MAX_PAGES = 10;

export class AdminGraphqlProductMediaReader implements ProductMediaReader {
  constructor(
    private readonly shopify: ShopifyApiContext,
    private readonly session: Session,
  ) {}

  async listMedia(productId: string): Promise<ProductMediaSnapshot[]> {
    const client = this.client();
    const media: ProductMediaSnapshot[] = [];
    let after: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const result: { data?: ProductMediaPageResponse } =
        await client.request<ProductMediaPageResponse>(
          `
            query ProductMediaIds($id: ID!, $first: Int!, $after: String) {
              product(id: $id) {
                media(first: $first, after: $after) {
                  nodes {
                    id
                    ... on MediaImage {
                      image {
                        url
                      }
                    }
                  }
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
                }
              }
            }
          `,
          { variables: { id: productId, first: PAGE_SIZE, after } },
        );

      if (!result.data) {
        throw new Error("Shopify không trả về danh sách media của sản phẩm");
      }
      if (!result.data.product) {
        throw new Error(`Không tìm thấy sản phẩm ${productId} trên Shopify`);
      }

      const connection = result.data.product.media;
      media.push(...connection.nodes.map(toSnapshot));
      if (!connection.pageInfo.hasNextPage) return media;
      after = connection.pageInfo.endCursor;
    }

    // Danh sách không đọc hết thì không được coi là đầy đủ: dừng thay vì đoán.
    throw new Error("Không đọc hết danh sách media của sản phẩm trên Shopify");
  }

  async readPrimaryImage(productId: string): Promise<ProductMediaSnapshot | null> {
    const result = await this.client().request<ProductPrimaryResponse>(
      `
        query ProductPrimaryImage($id: ID!) {
          product(id: $id) {
            media(first: 1, query: "media_type:IMAGE", sortKey: POSITION) {
              nodes {
                id
                ... on MediaImage {
                  image {
                    url
                  }
                }
              }
            }
          }
        }
      `,
      { variables: { id: productId } },
    );

    if (!result.data) {
      throw new Error("Shopify không trả về ảnh chính của sản phẩm");
    }
    if (!result.data.product) {
      throw new Error(`Không tìm thấy sản phẩm ${productId} trên Shopify`);
    }

    const node = result.data.product.media.nodes[0];
    return node ? toSnapshot(node) : null;
  }

  private client(): ShopifyGraphqlClient {
    return new this.shopify.api.clients.Graphql({ session: this.session });
  }
}

function toSnapshot(node: MediaNode): ProductMediaSnapshot {
  return { id: node.id, imageUrl: node.image?.url ?? null };
}
