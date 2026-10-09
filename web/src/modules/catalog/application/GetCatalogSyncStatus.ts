import {
  CATALOG_SYNC_STALE_MS,
  type CatalogSyncRepository,
  type CatalogSyncState,
} from "./CatalogSyncPorts.ts";

export const STALE_SYNC_ERROR =
  "Đồng bộ bị gián đoạn (quá 15 phút không có tiến triển). Hãy bấm đồng bộ lại.";

export class GetCatalogSyncStatus {
  constructor(private readonly repository: CatalogSyncRepository) {}

  async execute(shopDomain: string): Promise<CatalogSyncState> {
    if (!shopDomain.trim()) {
      throw new Error("Shop domain không được để trống");
    }
    const state = await this.repository.getState(shopDomain);
    if (!state.syncId || !isStale(state)) return state;

    // Không kết thúc thì UI xoay mãi và khóa nút đồng bộ. `fail` chỉ đổi đúng
    // sync này khi còn RUNNING, nên job sót lại của nó cũng tự dừng (isActive).
    await this.repository.fail(shopDomain, state.syncId, STALE_SYNC_ERROR);
    return this.repository.getState(shopDomain);
  }
}

function isStale(state: CatalogSyncState): boolean {
  if (state.status !== "RUNNING") return false;
  const lastProgress = state.heartbeatAt ?? state.startedAt;
  return !lastProgress || lastProgress.getTime() < Date.now() - CATALOG_SYNC_STALE_MS;
}
