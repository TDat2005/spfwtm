export type CatalogSyncStatus = "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";

/**
 * Sync RUNNING mà quá lâu không có trang nào xong (worker chết, job mất khỏi
 * queue) thì coi là bị gián đoạn: được bắt đầu lại và báo FAILED cho merchant.
 */
export const CATALOG_SYNC_STALE_MS = 15 * 60 * 1000;

export interface CatalogSyncState {
  syncId: string | null;
  status: CatalogSyncStatus;
  syncedCount: number;
  error: string | null;
  startedAt: Date | null;
  /** Lần cuối sync có tiến triển (bắt đầu hoặc xong một trang). */
  heartbeatAt: Date | null;
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
