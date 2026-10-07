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
  | { kind: "PRODUCT_TYPE"; productType: string };

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
    selection: WatermarkBatchSelection;
    maxJobs: number;
    design: WatermarkDesign;
  }): Promise<CreatedWatermarkBatch>;
  list(shopDomain: string): Promise<WatermarkBatchSummary[]>;
  cancel(batchId: string, shopDomain: string): Promise<void>;
}

export interface BatchDispatchState {
  batchId: string;
  shopDomain: string;
  totalJobs: number;
  /** Job đang chạy hoặc đã vào queue gần đây (enqueuedAt >= staleBefore). */
  inFlightJobs: number;
}

export interface WatermarkBatchDispatchRepository {
  getDispatchState(batchId: string, staleBefore: Date): Promise<BatchDispatchState | null>;
  /**
   * Đánh dấu tối đa `limit` job PENDING chưa vào queue (hoặc vào queue đã quá
   * `staleBefore` — có thể bị mất) là vừa được đưa vào queue, rồi trả về chúng.
   */
  claimJobs(batchId: string, limit: number, staleBefore: Date): Promise<CreatedBatchJob[]>;
  releaseJobs(jobIds: string[]): Promise<void>;
  listBatchesNeedingDispatch(staleBefore: Date, limit: number): Promise<string[]>;
}
