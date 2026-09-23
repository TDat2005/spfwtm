import type { WatermarkJob } from "../domain/WatermarkJob.ts";
import type { WatermarkJobRepository } from "./WatermarkPorts.ts";

export class GetWatermarkJob {
  constructor(private readonly repository: WatermarkJobRepository) {}

  async execute(id: string, shopDomain: string): Promise<WatermarkJob> {
    if (!id.trim()) throw new Error("Watermark job ID không được để trống");
    if (!shopDomain.trim()) throw new Error("Shop domain không được để trống");
    const job = await this.repository.findByIdForShop(id, shopDomain);
    if (!job) throw new Error("Không tìm thấy watermark job");
    return job;
  }
}
