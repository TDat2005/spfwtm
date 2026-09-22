import type { Product } from "../domain/Product.ts";

export interface ProductRepository {
    upsertMany(
        shopDomain: string,
        products: readonly Product[],
    ): Promise<void>;

    listByShop(shopDomain: string): Promise<Product[]>;
}