import type { Product } from "../domain/Product.ts";

export interface ProductTypeSummary {
    productType: string;
    productCount: number;
    withImageCount: number;
}

export interface ProductRepository {
    upsertMany(
        shopDomain: string,
        products: readonly Product[],
    ): Promise<void>;

    listByShop(shopDomain: string): Promise<Product[]>;

    listProductTypes(shopDomain: string): Promise<ProductTypeSummary[]>;
}