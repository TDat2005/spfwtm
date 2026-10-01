import type {
  WatermarkBatchRepository,
  WatermarkBatchSummary,
} from "./BulkWatermarkPorts.ts";

export class ListWatermarkBatches {
  constructor(private readonly repository: WatermarkBatchRepository) {}

  async execute(shopDomain: string): Promise<WatermarkBatchSummary[]> {
    if (!shopDomain.trim()) throw new Error("Shop domain không được để trống");
    return this.repository.list(shopDomain);
  }
}
