import { Product, type ProductStatus } from "../domain/Product.ts";
import type { ProductGateway, ProductPage } from "../application/ProductGateway.ts";
import type { Session } from "@shopify/shopify-api";
interface ShopifyGraphqlClient {
  request<T = undefined>(
    query: string,
    options?: { variables?: Record<string, unknown>; retries?: number }
  ): Promise<{
    data?: T extends undefined ? any : T;
  }>;
}

export interface ShopifyApiContext {
  api: {
    clients: {
      Graphql: new (options: { session: Session }) => ShopifyGraphqlClient;
    };
  };
}

interface ShopifyProductNode {
  id: string;
  title: string;
  status: string;
  featuredMedia: {
    id: string;
    preview: {
      image: {
        url: string;
        altText: string | null;
      } | null;
    } | null;
  } | null;
}

interface GetProductsResponse {
  products: {
    nodes: ShopifyProductNode[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

/** Tối đa của Shopify cho một connection. Query này rẻ nên lấy đủ 250. */
const PAGE_SIZE = 250;

export class ShopifyProductGateway implements ProductGateway {
  constructor(
    private readonly shopify: ShopifyApiContext,
    private readonly session: Session
  ) {}

  async listPage(cursor: string | null): Promise<ProductPage> {
    const client = new this.shopify.api.clients.Graphql({
      session: this.session,
    });

    // sortKey: ID giữ thứ tự ổn định giữa các trang; sort theo UPDATED_AT có thể
    // làm sản phẩm vừa sửa nhảy trang và bị bỏ sót.
    const result: { data?: GetProductsResponse } =
      await client.request<GetProductsResponse>(
        `
      query GetProducts($cursor: String) {
        products(first: ${PAGE_SIZE}, after: $cursor, sortKey: ID) {
          nodes {
            id
            title
            status
            featuredMedia {
              id
              preview {
                image {
                  url
                  altText
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
        // Client tự retry khi Shopify trả 429/5xx; lỗi khác để BullMQ retry cả job.
        { variables: { cursor }, retries: 2 }
      );
    if (!result.data) {
      throw new Error("Shopify GraphQL không trả về data");
    }

    const { nodes, pageInfo } = result.data.products;
    return {
      products: nodes.map((node: ShopifyProductNode) => {
        const image = node.featuredMedia?.preview?.image;

        return new Product({
          id: node.id,
          title: node.title,
          status: parseProductStatus(node.status),
          imageUrl: image?.url ?? null,
          imageAltText: image?.altText ?? null,
          mediaId: node.featuredMedia?.id ?? null,
        });
      }),
      nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null,
    };
  }
}

function parseProductStatus(status: string): ProductStatus {
  if (status === "ACTIVE" || status === "DRAFT" || status === "ARCHIVED") {
    return status;
  }

  throw new Error(`Trạng thái Shopify không hợp lệ: ${status}`);
}
