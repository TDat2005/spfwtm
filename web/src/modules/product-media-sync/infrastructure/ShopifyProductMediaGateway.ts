import type { Session } from "@shopify/shopify-api";
import type { ProductMediaGateway } from "../application/ReconcileProductMedia.ts";
import type {
  ProductMediaItem,
  ProductMediaState,
} from "../domain/ProductMediaChange.ts";

interface ShopifyGraphqlClient {
  request<T>(
    query: string,
    options?: { variables?: Record<string, unknown> }
  ): Promise<{ data?: T }>;
}

interface ShopifyApiContext {
  api: {
    clients: {
      Graphql: new (options: { session: Session }) => ShopifyGraphqlClient;
    };
  };
}

interface ShopifyMediaNode {
  id: string;
  alt: string | null;
  createdAt: string;
  image?: { url: string } | null;
}

interface ProductMediaResponse {
  product: {
    id: string;
    title: string;
    status: string;
    media: { nodes: ShopifyMediaNode[] };
  } | null;
}

export class ShopifyProductMediaGateway implements ProductMediaGateway {
  constructor(
    private readonly shopify: ShopifyApiContext,
    private readonly session: Session
  ) {}

  async getProductMedia(productId: string): Promise<ProductMediaState | null> {
    const client = new this.shopify.api.clients.Graphql({
      session: this.session,
    });
    const result = await client.request<ProductMediaResponse>(
      `
        query ProductPrimaryMedia($productId: ID!) {
          product(id: $productId) {
            id
            title
            status
            media(
              first: 20
              query: "media_type:IMAGE"
              sortKey: POSITION
            ) {
              nodes {
                id
                alt
                ... on MediaImage {
                  createdAt
                  image {
                    url
                  }
                }
              }
            }
          }
        }
      `,
      { variables: { productId } }
    );

    if (!result.data) {
      throw new Error("Shopify không trả về dữ liệu product media");
    }
    if (!result.data.product) return null;

    const media = result.data.product.media.nodes.map(toMediaItem);
    return {
      productId: result.data.product.id,
      title: result.data.product.title,
      status: productStatus(result.data.product.status),
      primaryMedia: media[0] ?? null,
      media,
    };
  }
}

function toMediaItem(node: ShopifyMediaNode): ProductMediaItem {
  return {
    id: node.id,
    imageUrl: node.image?.url ?? null,
    altText: node.alt,
    createdAt: parseDate(node.createdAt),
  };
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function productStatus(value: string): "ACTIVE" | "DRAFT" | "ARCHIVED" {
  if (value === "ACTIVE" || value === "DRAFT" || value === "ARCHIVED") {
    return value;
  }
  throw new Error(`Trạng thái Shopify không hợp lệ: ${value}`);
}
