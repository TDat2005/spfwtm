import type { Product } from "../domain/Product.ts";
import type { ProductRepository } from "./ProductRepository.ts";

export class ListProducts {
  constructor(
    private readonly productRepository: ProductRepository,
  ) { }

  async execute(shopDomain: string): Promise<Product[]> {
    if (!shopDomain.trim()) {
      throw new Error("Shop domain không được để trống");
    }

    return await this.productRepository.listByShop(shopDomain);
  }
}