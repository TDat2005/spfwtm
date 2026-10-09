import type { CatalogFilter } from "../domain/CatalogFilter.ts";
import type { WatermarkDesign } from "../domain/WatermarkDesign.ts";

export interface CreatedBatchJob {
  id: string;
  productId: string;
}

export interface CreatedWatermarkBatch {
  id: string;
  totalJobs: number;
  skippedProducts: number;
  createdAt: Date;
  jobs: CreatedBatchJob[];
}

export type WatermarkBatchSelection =
  | { kind: "PRODUCT_IDS"; productIds: string[] }
  | { kind: "PRODUCT_TYPE"; productType: string }
  | { kind: "COLLECTION"; collectionId: string };

/**
 * Sản phẩm thật sự đưa vào batch. Collection được đổi sang danh sách sản phẩm
 * trước, vì thành viên collection chỉ có trên Shopify (catalog không lưu).
 */
export type ResolvedBatchSelection =
  | { kind: "PRODUCT_IDS"; productIds: string[] }
  | { kind: "PRODUCT_TYPE"; productType: string }
  | { kind: "COLLECTION"; collectionId: string; productIds: string[] }
  /**
   * Sản phẩm đã lọc sẵn ("chọn tất cả khớp bộ lọc"). Sản phẩm bị xóa hoặc mất
   * ảnh giữa lúc lọc và lúc tạo batch được bỏ qua, giống collection.
   */
  | { kind: "PRODUCT_LIST"; productIds: string[] };

export interface CollectionProductLookup {
  /** GID sản phẩm trong collection; null = collection không còn tồn tại. */
  listProductIds(shopDomain: string, collectionId: string): Promise<string[] | null>;
}

export interface CatalogFilterReader {
  /** GID sản phẩm khớp bộ lọc, theo đúng thứ tự danh sách trong studio. */
  listMatchingProductIds(
    shopDomain: string,
    filter: CatalogFilter,
    collectionMemberIds: ReadonlySet<string> | null
  ): Promise<string[]>;
}

export type WatermarkBatchStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "PARTIAL_FAILED"
  | "FAILED"
  | "CANCELLED";

export interface WatermarkBatchSummary {
  id: string;
  totalJobs: number;
  pendingJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  status: WatermarkBatchStatus;
  createdAt: Date;
}

export interface WatermarkBatchRepository {
  create(input: {
    shopDomain: string;
    selection: ResolvedBatchSelection;
    maxJobs: number;
    design: WatermarkDesign;
  }): Promise<CreatedWatermarkBatch>;
  list(shopDomain: string): Promise<WatermarkBatchSummary[]>;
  cancel(batchId: string, shopDomain: string): Promise<void>;
}

/** Batch nhỏ (lane interactive) và batch lớn (lane bulk) có cửa sổ riêng trong mỗi shop. */
export type BatchSize = "SMALL" | "LARGE";

export interface BatchDispatchState {
  batchId: string;
  shopId: string;
  shopDomain: string;
  size: BatchSize;
  /** Job đang chạy hoặc đã vào queue của mọi batch cùng cỡ trong shop. */
  inFlightJobs: number;
}

export interface ClaimedBatchJob {
  id: string;
  batchId: string;
}

export interface WatermarkBatchDispatchRepository {
  getDispatchState(batchId: string): Promise<BatchDispatchState | null>;
  /**
   * Đánh dấu tối đa `limit` job PENDING chưa vào queue, thuộc các batch cùng cỡ
   * của shop (batch tạo trước được lấy trước), là đã vào queue rồi trả về chúng.
   */
  claimJobs(shopId: string, size: BatchSize, limit: number): Promise<ClaimedBatchJob[]>;
  releaseJobs(jobIds: string[]): Promise<void>;
  /** Batch còn job chưa vào queue, theo id tăng dần và sau `afterBatchId`. */
  listBatchesNeedingDispatch(afterBatchId: string | null, limit: number): Promise<string[]>;
}
