import { randomUUID } from "node:crypto";
import {
  CATALOG_SYNC_STALE_MS,
  type CatalogSyncQueue,
  type CatalogSyncRepository,
  type CatalogSyncState,
} from "./CatalogSyncPorts.ts";

export class StartCatalogSync {
  constructor(
    private readonly repository: CatalogSyncRepository,
    private readonly queue: CatalogSyncQueue,
  ) {}

  async execute(shopDomain: string): Promise<CatalogSyncState> {
    if (!shopDomain.trim()) {
      throw new Error("Shop domain không được để trống");
    }

    const syncId = randomUUID();
    const started = await this.repository.tryStart(
      shopDomain,
      syncId,
      new Date(Date.now() - CATALOG_SYNC_STALE_MS),
    );

    if (!started) return this.repository.getState(shopDomain);

    try {
      await this.queue.enqueuePage({ shopDomain, syncId, page: 1, cursor: null });
    } catch (error) {
      await this.repository.fail(shopDomain, syncId, "Không đưa được job đồng bộ vào hàng đợi");
      throw error;
    }

    return this.repository.getState(shopDomain);
  }
}
