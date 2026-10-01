import { randomUUID } from "node:crypto";
import type {
  CatalogSyncQueue,
  CatalogSyncRepository,
  CatalogSyncState,
} from "./CatalogSyncPorts.ts";

/** Sync RUNNING mà không có heartbeat trong khoảng này được coi là đã chết. */
const STALE_SYNC_MS = 15 * 60 * 1000;

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
      new Date(Date.now() - STALE_SYNC_MS),
    );

    // Đang có sync chạy: trả về trạng thái hiện tại thay vì chạy song song.
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
