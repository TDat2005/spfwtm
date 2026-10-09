import type { Session } from "@shopify/shopify-api";
import type {
  CollectionSummary,
  ShopCollections,
  ShopCollectionsFactory,
} from "../application/CollectionGateway.ts";

interface ShopifyGraphqlClient {
  request<T>(
    query: string,
    options?: { variables?: Record<string, unknown>; retries?: number }
  ): Promise<{ data?: T }>;
}

export interface ShopifyCollectionsContext {
  api: {
    clients: { Graphql: new (options: { session: Session }) => ShopifyGraphqlClient };
    session: { getOfflineId(shop: string): string };
  };
  config: {
    sessionStorage: { loadSession(id: string): Promise<Session | undefined> };
  };
}

const PAGE_SIZE = 250;
/** Chặn vòng lặp vô hạn nếu Shopify trả cursor lỗi; 200 trang = 50.000 sản phẩm. */
const MAX_PAGES = 200;

export class ShopifyCollectionsFactory implements ShopCollectionsFactory {
  constructor(private readonly shopify: ShopifyCollectionsContext) {}

  async forShop(shopDomain: string): Promise<ShopCollections> {
    const session = await this.shopify.config.sessionStorage.loadSession(
      this.shopify.api.session.getOfflineId(shopDomain),
    );
    if (!session) throw new Error(`Không tìm thấy offline session cho ${shopDomain}`);
    return new ShopifyCollections(new this.shopify.api.clients.Graphql({ session }));
  }
}

/** Shopify Admin GraphQL 2026-07: `Product.inCollection`, `Collection.products`, `collections`. */
export class ShopifyCollections implements ShopCollections {
  constructor(private readonly client: ShopifyGraphqlClient) {}

  async isInCollection(productId: string, collectionId: string): Promise<boolean> {
    const data = await this.request<{ product: { inCollection: boolean } | null }>(
      `query ProductInCollection($productId: ID!, $collectionId: ID!) {
        product(id: $productId) { inCollection(id: $collectionId) }
      }`,
      { productId, collectionId },
    );
    return data.product?.inCollection ?? false;
  }

  async listProductIds(collectionId: string): Promise<string[] | null> {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data: CollectionProductsResponse = await this.request<CollectionProductsResponse>(
        `query CollectionProductIds($id: ID!, $cursor: String) {
          collection(id: $id) {
            products(first: ${PAGE_SIZE}, after: $cursor) {
              nodes { id }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
        { id: collectionId, cursor },
      );
      if (!data.collection) return null;
      const { nodes, pageInfo } = data.collection.products;
      ids.push(...nodes.map((node) => node.id));
      if (!pageInfo.hasNextPage || !pageInfo.endCursor) return ids;
      cursor = pageInfo.endCursor;
    }
    throw new Error(`Collection ${collectionId} có quá ${MAX_PAGES * PAGE_SIZE} sản phẩm`);
  }

  async getCollectionTitle(collectionId: string): Promise<string | null> {
    const data = await this.request<{ collection: { title: string } | null }>(
      `query CollectionTitle($id: ID!) { collection(id: $id) { title } }`,
      { id: collectionId },
    );
    return data.collection?.title ?? null;
  }

  async search(query: string): Promise<CollectionSummary[]> {
    const term = query.replace(/[\\"'():*]/g, " ").trim();
    const data = await this.request<{
      collections: {
        nodes: Array<{ id: string; title: string; productsCount: { count: number } | null }>;
      };
    }>(
      `query SearchCollections($query: String, $sortKey: CollectionSortKeys) {
        collections(first: 50, query: $query, sortKey: $sortKey) {
          nodes { id title productsCount { count } }
        }
      }`,
      { query: term || null, sortKey: term ? "RELEVANCE" : "TITLE" },
    );
    return data.collections.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      productsCount: node.productsCount?.count ?? null,
    }));
  }

  private async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const result = await this.client.request<T>(query, { variables, retries: 2 });
    if (!result.data) throw new Error("Shopify GraphQL không trả về data");
    return result.data;
  }
}

interface CollectionProductsResponse {
  collection: {
    products: {
      nodes: Array<{ id: string }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}
