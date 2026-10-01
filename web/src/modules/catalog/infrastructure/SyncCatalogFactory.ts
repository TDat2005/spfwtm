import type { Session } from "@shopify/shopify-api";
import type { ProductRepository } from "../application/ProductRepository.ts";
import { SyncCatalog } from "../application/SyncCatalog.ts";
import { ShopifyProductGateway } from "./ShopifyProductGateway.ts";

type ShopifyApiContext = ConstructorParameters<typeof ShopifyProductGateway>[0];

/**
 * SyncCatalog cần session của từng request, nên Nest không thể tạo sẵn một
 * instance dùng chung. Factory này là singleton, mỗi request gọi create(session).
 */
export class SyncCatalogFactory {
  constructor(
    private readonly shopify: ShopifyApiContext,
    private readonly productRepository: ProductRepository,
  ) {}

  create(session: Session): SyncCatalog {
    return new SyncCatalog(
      new ShopifyProductGateway(this.shopify, session),
      this.productRepository,
    );
  }
}
