import type { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import { WATERMARK_PROCESS_V1 } from "../../jobs/domain/JobDefinitions.ts";
import {
  WatermarkConfiguration,
  type WatermarkConfigurationProps,
} from "../domain/WatermarkConfiguration.ts";
import type {
  CreatedWatermarkBatch,
  WatermarkBatchRepository,
  WatermarkBatchSelection,
} from "./BulkWatermarkPorts.ts";

const MAX_SELECTED_PRODUCTS = 1_000;
const MAX_PRODUCT_TYPE_JOBS = 5_000;
const ENQUEUE_CHUNK_SIZE = 1_000;

export interface CreateWatermarkBatchInput {
  shopDomain: string;
  selection: WatermarkBatchSelection;
  configuration: WatermarkConfigurationProps;
}

export class CreateWatermarkBatch {
  constructor(
    private readonly repository: WatermarkBatchRepository,
    private readonly enqueueJob: EnqueueJob
  ) {}

  async execute(
    input: CreateWatermarkBatchInput
  ): Promise<CreatedWatermarkBatch> {
    if (!input.shopDomain.trim()) {
      throw new Error("Shop domain không được để trống");
    }

    const selection = normalizeSelection(input.selection);
    const batch = await this.repository.create({
      shopDomain: input.shopDomain,
      selection,
      maxJobs:
        selection.kind === "PRODUCT_IDS"
          ? MAX_SELECTED_PRODUCTS
          : MAX_PRODUCT_TYPE_JOBS,
      configuration: new WatermarkConfiguration(input.configuration),
    });

    for (let i = 0; i < batch.jobs.length; i += ENQUEUE_CHUNK_SIZE) {
      await this.enqueueJob.executeMany(
        batch.jobs.slice(i, i + ENQUEUE_CHUNK_SIZE).map((job) => ({
          ...WATERMARK_PROCESS_V1,
          payload: {
            jobId: job.id,
            shopDomain: input.shopDomain,
            batchId: batch.id,
          },
        }))
      );
    }
    return batch;
  }
}

function normalizeSelection(
  selection: WatermarkBatchSelection
): WatermarkBatchSelection {
  if (selection.kind === "PRODUCT_TYPE") {
    return { kind: "PRODUCT_TYPE", productType: selection.productType.trim() };
  }

  const productIds = [
    ...new Set(selection.productIds.map((id) => id.trim())),
  ].filter(Boolean);
  if (productIds.length === 0) {
    throw new Error("Hãy chọn ít nhất một sản phẩm");
  }
  if (productIds.length > MAX_SELECTED_PRODUCTS) {
    throw new Error("Mỗi batch chỉ hỗ trợ tối đa 1.000 sản phẩm");
  }
  return { kind: "PRODUCT_IDS", productIds };
}
