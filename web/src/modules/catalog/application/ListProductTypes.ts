import type { ProductRepository, ProductTypeSummary } from "./ProductRepository.ts";

export class ListProductTypes {
  constructor(private readonly productRepository: ProductRepository) {}

  async execute(shopDomain: string): Promise<ProductTypeSummary[]> {
    if (!shopDomain.trim()) {
      throw new Error("Shop domain không được để trống");
    }
    return this.productRepository.listProductTypes(shopDomain);
  }
}
