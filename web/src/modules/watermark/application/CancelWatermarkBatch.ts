import type { WatermarkBatchRepository } from "./BulkWatermarkPorts.ts";

export class CancelWatermarkBatch {
  constructor(private readonly repository: WatermarkBatchRepository) {}

  async execute(batchId: string, shopDomain: string): Promise<void> {
    if (!batchId.trim()) throw new Error("Batch ID không được để trống");
    if (!shopDomain.trim()) throw new Error("Shop domain không được để trống");
    await this.repository.cancel(batchId, shopDomain);
  }
}
