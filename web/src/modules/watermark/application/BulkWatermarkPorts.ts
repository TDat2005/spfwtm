import type { WatermarkConfiguration } from "../domain/WatermarkConfiguration.ts";

export interface CreatedBatchJob {
  id: string;
  productId: string;
}

export interface CreatedWatermarkBatch {
  id: string;
  totalJobs: number;
  createdAt: Date;
  jobs: CreatedBatchJob[];
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
    productIds: string[];
    configuration: WatermarkConfiguration;
  }): Promise<CreatedWatermarkBatch>;
  list(shopDomain: string): Promise<WatermarkBatchSummary[]>;
  cancel(batchId: string, shopDomain: string): Promise<void>;
}
