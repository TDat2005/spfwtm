import { Product, type ProductStatus } from "../domain/Product.ts";
import type { ProductGateway } from "../application/ProductGateway.ts";
import type { Session } from "@shopify/shopify-api";
interface ShopifyGraphqlClient {
  request<T = undefined>(
    query: string,
    options?: { variables?: Record<string, unknown> }
  ): Promise<{
    data?: T extends undefined ? any : T;
  }>;
}

interface ShopifyApiContext {
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

export class ShopifyProductGateway implements ProductGateway {
  constructor(
    private readonly shopify: ShopifyApiContext,
    private readonly session: Session
  ) {}

  async list(): Promise<Product[]> {
    const client = new this.shopify.api.clients.Graphql({
      session: this.session,
    });

    const products: Product[] = [];
    let cursor: string | null = null;

    do {
      const result: { data?: GetProductsResponse } =
        await client.request<GetProductsResponse>(
          `
      query GetProducts($cursor: String) {
        products(first: 100, after: $cursor, sortKey: UPDATED_AT, reverse: true) {
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
          { variables: { cursor } }
        );
      if (!result.data) {
        throw new Error("Shopify GraphQL không trả về data");
      }
      products.push(
        ...result.data.products.nodes.map((node: ShopifyProductNode) => {
          const image = node.featuredMedia?.preview?.image;

          return new Product({
            id: node.id,
            title: node.title,
            status: parseProductStatus(node.status),
            imageUrl: image?.url ?? null,
            imageAltText: image?.altText ?? null,
            mediaId: node.featuredMedia?.id ?? null,
          });
        })
      );
      cursor = result.data.products.pageInfo.hasNextPage
        ? result.data.products.pageInfo.endCursor
        : null;
    } while (cursor && products.length < 1_000);

    return products.slice(0, 1_000);
  }
}

function parseProductStatus(status: string): ProductStatus {
  if (status === "ACTIVE" || status === "DRAFT" || status === "ARCHIVED") {
    return status;
  }

  throw new Error(`Trạng thái Shopify không hợp lệ: ${status}`);
}
