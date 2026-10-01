export type CatalogSyncStatus = "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";

export interface CatalogSyncState {
  syncId: string | null;
  status: CatalogSyncStatus;
  syncedCount: number;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface CatalogSyncRepository {
  getState(shopDomain: string): Promise<CatalogSyncState>;

  tryStart(shopDomain: string, syncId: string, staleBefore: Date): Promise<boolean>;

  isActive(shopDomain: string, syncId: string): Promise<boolean>;

  recordPage(shopDomain: string, syncId: string, page: number, productCount: number): Promise<void>;

  complete(shopDomain: string, syncId: string): Promise<void>;
  fail(shopDomain: string, syncId: string, error: string): Promise<void>;
}

export interface CatalogSyncPageInput {
  shopDomain: string;
  syncId: string;
  page: number;
  cursor: string | null;
}

export interface CatalogSyncQueue {
  enqueuePage(input: CatalogSyncPageInput): Promise<void>;
}
