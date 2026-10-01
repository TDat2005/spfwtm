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

  /**
   * Tạo shop nếu chưa có rồi chuyển sang RUNNING với syncId mới.
   * Trả về false nếu shop đang có sync RUNNING với heartbeat mới hơn staleBefore.
   */
  tryStart(shopDomain: string, syncId: string, staleBefore: Date): Promise<boolean>;

  /** false nếu syncId không còn là sync đang chạy của shop (đã bị thay thế hoặc kết thúc). */
  isActive(shopDomain: string, syncId: string): Promise<boolean>;

  /**
   * Ghi nhận trang `page` (bắt đầu từ 1). Chỉ cộng dồn khi trang trước đó đã được ghi,
   * nên job retry cùng một trang không bị đếm hai lần.
   */
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
