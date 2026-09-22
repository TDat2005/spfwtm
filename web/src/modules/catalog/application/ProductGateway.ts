import type { Product } from "../domain/Product.js";

export interface ProductGateway {
  list(): Promise<Product[]>;
}