import { Inject, Injectable } from "@nestjs/common";
import type { Session } from "@shopify/shopify-api";
import productCreator from "../../../product-creator.js";
import { SHOPIFY, type ShopifyApp } from "../../shared/nest/tokens.ts";

@Injectable()
export class ProductsService {
  constructor(@Inject(SHOPIFY) private readonly shopify: ShopifyApp) {}

  async count(session: Session): Promise<number> {
    const client = new this.shopify.api.clients.Graphql({ session });
    const result = await client.request<{ productsCount: { count: number } }>(`
      query shopifyProductCount {
        productsCount { count }
      }
    `);
    if (!result.data) throw new Error("Không nhận được productsCount từ Shopify");
    return result.data.productsCount.count;
  }

  async createSampleProducts(session: Session): Promise<void> {
    await productCreator(this.shopify, session);
  }
}
