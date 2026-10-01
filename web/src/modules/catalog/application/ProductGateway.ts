import type { Product } from "../domain/Product.ts";

export interface ProductPage {
  products: Product[];
  nextCursor: string | null;
}

export interface ProductGateway {
  listPage(cursor: string | null): Promise<ProductPage>;
}

export interface ProductGatewayFactory {
  forShop(shopDomain: string): Promise<ProductGateway>;
}
