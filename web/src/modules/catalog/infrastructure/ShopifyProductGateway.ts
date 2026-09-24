import {
  Product,
  type ProductStatus,
} from "../domain/Product.ts";
import type { ProductGateway } from "../application/ProductGateway.ts";
import type { Session } from "@shopify/shopify-api";
interface ShopifyGraphqlClient {
  request<T = undefined>(
    query: string,
  ): Promise<{
    data?: T extends undefined ? any : T;
  }>;
}

interface ShopifyApiContext {
  api: {
    clients: {
      Graphql: new (options: {
        session: Session;
      }) => ShopifyGraphqlClient;
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
  };
}

export class ShopifyProductGateway implements ProductGateway {
  constructor(
    private readonly shopify: ShopifyApiContext,
    private readonly session: Session,
  ) { }

  async list(): Promise<Product[]> {
    const client = new this.shopify.api.clients.Graphql({
      session: this.session,
    });

    const result = await client.request<GetProductsResponse>(`
      query GetProducts {
        products(first: 10, sortKey: UPDATED_AT, reverse: true) {
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
        }
      }
    `);
    if (!result.data) {
      throw new Error("Shopify GraphQL không trả về data");
    }
    return result.data.products.nodes.map((node) => {
      const image = node.featuredMedia?.preview?.image;

      return new Product({
        id: node.id,
        title: node.title,
        status: parseProductStatus(node.status),
        imageUrl: image?.url ?? null,
        imageAltText: image?.altText ?? null,
        mediaId: node.featuredMedia?.id ?? null,
      });
    });
  }
}

function parseProductStatus(status: string): ProductStatus {
  if (
    status === "ACTIVE" ||
    status === "DRAFT" ||
    status === "ARCHIVED"
  ) {
    return status;
  }

  throw new Error(`Trạng thái Shopify không hợp lệ: ${status}`);
}
