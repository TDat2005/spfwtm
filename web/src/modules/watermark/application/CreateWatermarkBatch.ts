import type { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import { WATERMARK_PROCESS_V1 } from "../../jobs/domain/JobDefinitions.ts";
import {
  WatermarkConfiguration,
  type WatermarkConfigurationProps,
} from "../domain/WatermarkConfiguration.ts";
import type {
  CreatedWatermarkBatch,
  WatermarkBatchRepository,
} from "./BulkWatermarkPorts.ts";

export interface CreateWatermarkBatchInput {
  shopDomain: string;
  productIds: string[];
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
    const productIds = [
      ...new Set(input.productIds.map((id) => id.trim())),
    ].filter(Boolean);
    if (productIds.length === 0) {
      throw new Error("Hãy chọn ít nhất một sản phẩm");
    }
    if (productIds.length > 1_000) {
      throw new Error("Mỗi batch chỉ hỗ trợ tối đa 1.000 sản phẩm");
    }

    const batch = await this.repository.create({
      shopDomain: input.shopDomain,
      productIds,
      configuration: new WatermarkConfiguration(input.configuration),
    });

    await this.enqueueJob.executeMany(
      batch.jobs.map((job) => ({
        ...WATERMARK_PROCESS_V1,
        payload: {
          jobId: job.id,
          shopDomain: input.shopDomain,
          batchId: batch.id,
        },
      }))
    );
    return batch;
  }
}
