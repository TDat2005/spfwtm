import type { ProductGateway } from "./ProductGateway.ts";
import type { ProductRepository } from "./ProductRepository.ts";

export interface SyncCatalogResult {
    syncedCount: number;
}

export class SyncCatalog {
    constructor(
        private readonly productGateway: ProductGateway,
        private readonly productRepository: ProductRepository,
    ) { }

    async execute(shopDomain: string): Promise<SyncCatalogResult> {
        if (!shopDomain.trim()) {
            throw new Error("Shop domain không được để trống");
        }

        const products = await this.productGateway.list();

        await this.productRepository.upsertMany(
            shopDomain,
            products,
        );

        return {
            syncedCount: products.length,
        };
    }
}