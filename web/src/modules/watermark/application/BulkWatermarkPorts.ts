import type { WatermarkConfiguration } from "../domain/WatermarkConfiguration.ts";

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
    configuration: WatermarkConfiguration;
  }): Promise<CreatedWatermarkBatch>;
  list(shopDomain: string): Promise<WatermarkBatchSummary[]>;
  cancel(batchId: string, shopDomain: string): Promise<void>;
}
