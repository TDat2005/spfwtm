import type { ProductGatewayFactory } from "./ProductGateway.ts";
import type { ProductRepository } from "./ProductRepository.ts";
import type {
  CatalogSyncPageInput,
  CatalogSyncQueue,
  CatalogSyncRepository,
} from "./CatalogSyncPorts.ts";

/**
 * Đồng bộ một trang sản phẩm rồi xếp job cho trang kế tiếp.
 * Mỗi trang là một job riêng: shop lớn không bị giới hạn số sản phẩm,
 * job retry chỉ chạy lại đúng trang lỗi, và job của các shop khác được xen kẽ.
 */
export class SyncCatalogPage {
  constructor(
    private readonly gateways: ProductGatewayFactory,
    private readonly products: ProductRepository,
    private readonly syncs: CatalogSyncRepository,
    private readonly queue: CatalogSyncQueue,
  ) {}

  async execute(input: CatalogSyncPageInput): Promise<void> {
    if (!(await this.syncs.isActive(input.shopDomain, input.syncId))) return;

    const gateway = await this.gateways.forShop(input.shopDomain);
    const page = await gateway.listPage(input.cursor);

    await this.products.upsertMany(input.shopDomain, page.products);
    await this.syncs.recordPage(input.shopDomain, input.syncId, input.page, page.products.length);

    if (page.nextCursor) {
      await this.queue.enqueuePage({
        shopDomain: input.shopDomain,
        syncId: input.syncId,
        page: input.page + 1,
        cursor: page.nextCursor,
      });
    } else {
      await this.syncs.complete(input.shopDomain, input.syncId);
    }
  }
}
