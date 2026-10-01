import type { Session } from "@shopify/shopify-api";
import type { ProductGateway, ProductGatewayFactory } from "../application/ProductGateway.ts";
import { ShopifyProductGateway, type ShopifyApiContext } from "./ShopifyProductGateway.ts";

interface ShopifyOfflineSessions extends ShopifyApiContext {
  api: ShopifyApiContext["api"] & {
    session: { getOfflineId(shop: string): string };
  };
  config: {
    sessionStorage: { loadSession(id: string): Promise<Session | undefined> };
  };
}

/** Tạo gateway từ offline session của shop, dùng được trong job chạy nền. */
export class ShopifyProductGatewayFactory implements ProductGatewayFactory {
  constructor(private readonly shopify: ShopifyOfflineSessions) {}

  async forShop(shopDomain: string): Promise<ProductGateway> {
    const session = await this.shopify.config.sessionStorage.loadSession(
      this.shopify.api.session.getOfflineId(shopDomain),
    );
    if (!session) {
      throw new Error(`Không tìm thấy offline session cho ${shopDomain}`);
    }
    return new ShopifyProductGateway(this.shopify, session);
  }
}
