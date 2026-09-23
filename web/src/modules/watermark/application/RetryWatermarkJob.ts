import type { WatermarkJob } from "../domain/WatermarkJob.ts";
import type { WatermarkJobRepository } from "./WatermarkPorts.ts";

export class RetryWatermarkJob {
  constructor(private readonly repository: WatermarkJobRepository) {}

  async execute(id: string, shopDomain: string): Promise<WatermarkJob> {
    const job = await this.repository.findByIdForShop(id, shopDomain);
    if (!job) throw new Error("Không tìm thấy watermark job");
    job.retry();
    await this.repository.save(job);
    return job;
  }
}
