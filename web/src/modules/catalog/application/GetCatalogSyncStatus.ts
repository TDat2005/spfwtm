import type { CatalogSyncRepository, CatalogSyncState } from "./CatalogSyncPorts.ts";

export class GetCatalogSyncStatus {
  constructor(private readonly repository: CatalogSyncRepository) {}

  async execute(shopDomain: string): Promise<CatalogSyncState> {
    if (!shopDomain.trim()) {
      throw new Error("Shop domain không được để trống");
    }
    return this.repository.getState(shopDomain);
  }
}
