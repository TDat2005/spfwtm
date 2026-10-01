import type { Product } from "../domain/Product.ts";

export interface ProductPage {
  products: Product[];
  /** null khi đã tới trang cuối. */
  nextCursor: string | null;
}

export interface ProductGateway {
  listPage(cursor: string | null): Promise<ProductPage>;
}

/** Job chạy nền không có request session, nên gateway được tạo theo shop. */
export interface ProductGatewayFactory {
  forShop(shopDomain: string): Promise<ProductGateway>;
}
